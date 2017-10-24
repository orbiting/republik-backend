const Roles = require('../../lib/Roles')
const createUser = require('../../lib/factories/createUser')

module.exports = {
  content: ({ content, published, adminUnpublished }, args, { t }) =>
    (!published || adminUnpublished)
      ? t('api/comment/removedPlaceholder')
      : content,

  score: comment =>
    comment.upVotes - comment.downVotes,

  userCanEdit: ({ userId }, args, { user }) =>
    userId === user.id,

  comments: async ({ id }, args, { pgdb }) => {
    // TODO: Honor these options
    // const { orderBy, after, take } = args

    const comments = await pgdb.public.comments.find({ parentId: id })

    return {
      totalCount: comments.length,
      pageInfo: {hasNextPage: false},
      nodes: comments
    }
  },

  userVote: ({ votes }, args, { user }) => {
    const userVote = votes.find(v => v.userId === user.id)
    if (userVote) {
      return userVote.vote === -1
        ? 'DOWN'
        : 'UP'
    }
    return null
  },

  author: async ({ author, userId }, args, { pgdb, user, commenter }) => {
    if (!(Roles.userHasRole(user, 'admin') || Roles.userHasRole(user, 'editor'))) {
      return null
    }
    return author || commenter || createUser(
      await pgdb.public.users.findOne({ id: userId })
    )
  },

  displayAuthor: async (
    comment,
    args,
    {
      pgdb,
      user,
      t,
      discussion: _discussion,
      commenter: _commenter,
      commenterPreferences: _commenterPreferences,
      credential: _credential
    }
  ) => {
    if (comment.displayAuthor) {
      return comment.displayAuthor
    }

    const commenter = _commenter ||
      createUser(
        await pgdb.public.users.findOne({
          id: comment.userId
        })
      )
    const commenterPreferences = _commenterPreferences ||
      await pgdb.public.discussionPreferences.findOne({
        userId: commenter.id,
        discussionId: comment.discussionId
      })
    const discussion = _discussion ||
      await pgdb.public.discussions.findOne({
        id: comment.discussionId
      })
    const credential = commenterPreferences && commenterPreferences.credentialId
      ? _credential || await pgdb.public.credentials.findOne({ id: commenterPreferences.credentialId })
      : null

    let anonymous
    if (discussion.anonymity === 'ENFORCED') {
      anonymous = true
    } else { // FORBIDDEN or ALLOWED
      if (commenterPreferences && commenterPreferences.anonymous != null) {
        anonymous = commenterPreferences.anonymous
      } else {
        anonymous = false
      }
    }

    return anonymous
      ? {
        name: t('api/comment/anonymous/displayName'),
        profilePicture: null,
        credential
      }
      : {
        name: commenter.name,
        profilePicture: null, // TODO
        credential
      }
  }
}
