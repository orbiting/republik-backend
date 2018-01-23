const logger = console
const {ascending} = require('d3-array')
const { Roles } = require('@orbiting/backend-modules-auth')
const uniq = require('lodash/uniq')
const { transformUser } = require('@orbiting/backend-modules-auth')
const { Redirections: {
  upsert: upsertRedirection
} } = require('@orbiting/backend-modules-redirections')
const { publishMonitor } = require('../../../../../lib/slack')

module.exports = async (_, args, context) => {
  const {pgdb, req, t, mail: { unsubscribeEmail, enforceSubscriptions }} = context
  Roles.ensureUserHasRole(req.user, 'admin')

  const {targetUserId, sourceUserId} = args

  const now = new Date()
  const transaction = await pgdb.transactionBegin()
  try {
    const targetUser = await transaction.public.users.findOne({id: targetUserId})
    if (!targetUser) {
      logger.error('target user not found', { req: req._log(), targetUserId })
      throw new Error(t('api/users/404'))
    }
    const sourceUser = await transaction.public.users.findOne({id: sourceUserId})
    if (!sourceUser) {
      logger.error('source user not found', { req: req._log(), sourceUserId })
      throw new Error(t('api/users/404'))
    }

    if (targetUser.id === sourceUser.id) {
      logger.error('source- and target-user must not be the same', { req: req._log(), sourceUser, targetUser })
      throw new Error(t('api/users/merge/sourceAndTargetIdentical'))
    }

    const users = [targetUser, sourceUser]

    const publishedStatement = (u) => (
      u.isListed && !u.isAdminUnlisted
    )
    const statementUser = users.filter(u => u.statement).sort(
      (a, b) => ascending(
        publishedStatement(a) ? 0 : 1,
        publishedStatement(b) ? 0 : 1
      )
    )[0]

    // remove unique values from source
    await transaction.public.users.updateOne(
      { id: sourceUser.id },
      {
        testimonialId: null,
        username: null
      }
    )

    const newUser = await transaction.public.users.updateAndGetOne({
      id: targetUser.id
    }, {
      firstName: users.map(u => u.firstName).filter(Boolean)[0],
      lastName: users.map(u => u.lastName).filter(Boolean)[0],
      username: users.map(u => u.username).filter(Boolean)[0],
      birthday: users.map(u => u.birthday).filter(Boolean)[0],
      phoneNumber: users.map(u => u.phoneNumber).filter(Boolean)[0],
      addressId: users.map(u => u.addressId).filter(Boolean)[0],
      hasPublicProfile: users.map(u => u.hasPublicProfile).filter(Boolean)[0],
      facebookId: users.map(u => u.facebookId).filter(Boolean)[0],
      twitterHandle: users.map(u => u.twitterHandle).filter(Boolean)[0],
      publicUrl: users.map(u => u.publicUrl).filter(Boolean)[0],
      biography: users.map(u => u.biography).filter(Boolean)[0],
      pgpPublicKey: users.map(u => u.pgpPublicKey).filter(Boolean)[0],
      phoneNumberNote: users.map(u => u.phoneNumberNote).filter(Boolean)[0],
      phoneNumberAccessRole: users.map(u => u.phoneNumberAccessRole).filter(Boolean)[0],
      emailAccessRole: users.map(u => u.emailAccessRole).filter(Boolean)[0],
      ageAccessRole: users.map(u => u.ageAccessRole).filter(Boolean)[0],
      statement: statementUser && statementUser.statement,
      isListed: statementUser && statementUser.isListed,
      isAdminUnlisted: statementUser && statementUser.isAdminUnlisted,
      testimonialId: statementUser && statementUser.testimonialId,
      portraitUrl: statementUser
        ? statementUser.portraitUrl
        : users.map(u => u.portraitUrl).filter(Boolean)[0],
      badges: uniq([
        ...targetUser.badges || [],
        ...sourceUser.badges || []
      ].filter(Boolean)),
      roles: uniq([
        ...targetUser.roles || [],
        ...sourceUser.roles || []
      ].filter(Boolean)),
      createdAt: users.map(u => u.createdAt).sort((a, b) => ascending(a.createdAt, b.createdAt))[0],
      updatedAt: now
    })
    // ignored:
    //  previewsSentAt

    if (sourceUser.username && targetUser.username) {
      await upsertRedirection({
        source: `/~${sourceUser.username}`,
        target: `/~${targetUser.username}`,
        resource: { user: { id: targetUser.id } },
        status: 302 // allow reclaiming by somebody else
      }, context, now)
    }

    // transfer belongings
    const from = { userId: sourceUser.id }
    const to = { userId: targetUser.id }
    await transaction.public.paymentSources.update(from, to)
    await transaction.public.pledges.update(from, to)
    await transaction.public.memberships.update(from, to)
    if (!await (transaction.public.ballots.findFirst(to))) {
      await transaction.public.ballots.update(from, to)
    }
    await transaction.public.stripeCustomers.update(from, to)
    await transaction.public.discussionPreferences.update(from, to)
    await transaction.public.comments.update(from, to)
    await transaction.public.credentials.update(from, to)

    let sessions = await transaction.public.sessions.find({'sess @>': {passport: {user: sourceUser.id}}})
    for (let session of sessions) {
      const sess = Object.assign({}, session.sess, {
        passport: {user: targetUser.id}
      })
      await transaction.public.sessions.updateOne({ id: session.id }, {sess})
    }
    await transaction.public.eventLog.update(from, to)

    // remove addresses
    const addressIds = users
      .filter(u => u.addressId && u.addressId !== newUser.addressId)
      .map(u => u.addressId)
    if (addressIds.length) {
      await transaction.public.addresses.deleteOne({id: addressIds[0]})
    }

    // remove old user
    await transaction.public.users.deleteOne({id: sourceUser.id})
    await transaction.transactionCommit()

    try {
      await unsubscribeEmail({ email: sourceUser.email })
      await enforceSubscriptions({ pgdb, userId: targetUserId })
    } catch (_e) {
      logger.error('newsletter subscription changes failed in mergeUsers!', _e)
    }

    await publishMonitor(
      req.user,
      `mergeUsers ${sourceUser.email} -> ${targetUser.email}`
    )
  } catch (e) {
    await transaction.transactionRollback()
    logger.info('transaction rollback', { req: req._log(), args, error: e })
    throw e
  }

  return transformUser(await pgdb.public.users.findOne({id: targetUserId}))
}
