const graphqlFields = require('graphql-fields')
const {
  ascending,
  descending
} = require('d3-array')
const _ = {
  remove: require('lodash/remove'),
  uniq: require('lodash/uniq')
}
const Roles = require('../../../lib/Roles')
const createUser = require('../../../lib/factories/createUser')

// afterId and compare are optional
const assembleTree = (_comment, _comments, afterId, compare) => {
  let coveredComments = []
  const _assembleTree = (comment, comments, depth = -1) => {
    const parentId = comment.id || null
    comment._depth = depth
    comment.comments = {
      nodes:
        _.remove(comments, c => c.parentId === parentId)
    }
    if (depth === -1 && afterId) {
      comment.comments.nodes = comment.comments.nodes
        .sort(compare)
      const afterIndex = comment.comments.nodes
        .findIndex(c => c.id === afterId)
      comment.comments.nodes = comment.comments.nodes
        .slice(afterIndex + 1)
    }
    comment.comments.nodes = comment.comments.nodes
      .map(c => {
        coveredComments.push(c)
        return c
      })
      .map(c => _assembleTree(c, comments, depth + 1))
    return comment
  }
  _assembleTree(_comment, _comments)
  return coveredComments
}

const measureTree = comment => {
  const { comments } = comment
  const numChildren = comments.nodes.reduce(
    (acc, value) => {
      return acc + measureTree(value)
    },
    0
  )
  comment.comments = {
    ...comments,
    totalCount: numChildren,
    pageInfo: {
      hasNextPage: false,
      endCursor: null
    }
  }
  return numChildren + 1
}

const sortTree = (comment, compare) => {
  const { comments } = comment
  comment.comments = {
    ...comments,
    nodes: comments.nodes.sort((a, b) => compare(a, b))
  }
  if (comments.nodes.length > 0) {
    comments.nodes.forEach(c => sortTree(c, compare))
  }
  return comment
}

const filterTree = (comment, ids, cursorEnv) => {
  if (ids.length === 0) {
    return comment
  }
  const { comments, id } = comment
  if (comments.nodes.length > 0) {
    const nodes = comments.nodes.filter(n => filterTree(n, ids, cursorEnv) > 0)
    const endCursor = comments.nodes.length === nodes.length || nodes.length === 0
      ? null
      : Buffer.from(JSON.stringify({
        ...cursorEnv,
        parentId: id,
        afterId: nodes[nodes.length - 1].id
      })).toString('base64')
    comment.comments = {
      ...comments,
      nodes,
      pageInfo: {
        ...comments.pageInfo,
        hasNextPage: !!endCursor || comments.totalCount > 0,
        endCursor
      }
    }
    return nodes.length > 0 || ids.indexOf(id) > -1
  } else {
    return ids.indexOf(id) > -1
  }
}

const cutTreeX = (comment, maxDepth, depth = -1) => {
  const { comments } = comment
  if (depth === maxDepth) {
    comment.comments = {
      ...comments,
      nodes: [],
      pageInfo: {
        ...comments.pageInfo,
        hasNextPage: comments.pageInfo.hasNextPage || comments.totalCount > 0
      }
    }
  } else {
    comments.nodes.forEach(c => cutTreeX(c, maxDepth, depth + 1))
  }
  return comment
}

const decorateTree = async (comment, coveredComments, user, pgdb, t) => {
  // preload data
  const userIds = _.uniq(
    coveredComments.map(c => c.userId)
  )
  const users = await pgdb.public.users.find({ id: userIds })
    .then(users => users.map(u => createUser(u)))
  const discussionPreferences = await pgdb.public.discussionPreferences.find({
    userId: userIds,
    discussionId: coveredComments[0].discussionId
  })
  const credentialIds = discussionPreferences.map(dp => dp.credentialId)
  const credentials = await pgdb.public.credentials.find({ id: credentialIds })

  const showRealUser = Roles.userHasRole(user, 'admin') || Roles.userHasRole(user, 'editor')

  const _decorateTree = (comment) => {
    const { comments } = comment
    comment.comments = {
      ...comments,
      nodes: comments.nodes.map(c => {
        if (!c.published || c.adminUnpublished) {
          c.content = t('api/comment/removedPlaceholder')
        }
        const commentUser = users.find(u => u.id === c.userId)
        if (showRealUser) {
          c.author = commentUser
        }

        let displayAuthor = {}
        const userPreference = discussionPreferences.find(dp => dp.userId === commentUser.id)
        if (userPreference.anonymous) {
          displayAuthor = {
            name: t('api/comment/anonymous/displayName')
          }
        } else {
          displayAuthor = {
            name: commentUser.name(),
            profilePicture: null // TODO
          }
        }

        const credential = userPreference && userPreference.credentialId
          ? credentials.find(c => c.id === userPreference.credentialId)
          : null
        if (credential) {
          displayAuthor = {
            ...displayAuthor,
            credential
          }
        }
        c.displayAuthor = displayAuthor

        const userVote = c.votes.find(v => v.userId === user.id)
        let vote
        if (userVote) {
          if (userVote.vote === -1) {
            vote = 'DOWN'
          } else if (userVote.vote === 1) {
            vote = 'UP'
          }
        }
        c.userVote = vote
        c.userCanEdit = c.userId === user.id
        return c
      })
    }
    if (comments.nodes.length > 0) {
      comments.nodes.forEach(c => _decorateTree(c))
    }
    return comment
  }

  return _decorateTree(comment)
}

const meassureDepth = (fields, depth = 0) => {
  if (fields.nodes && fields.nodes.comments) {
    return meassureDepth(fields.nodes.comments, depth + 1)
  } else {
    return depth
  }
}

module.exports = async (discussion, args, { pgdb, user, t }, info) => {
  const maxDepth = meassureDepth(graphqlFields(info))

  const { after } = args
  const options = after
    ? {
      ...args,
      ...JSON.parse(Buffer.from(after, 'base64').toString())
    }
    : args
  const {
    orderBy = 'HOT',
    orderDirection = 'DESC',
    first = 200,
    afterId,
    focusId,
    parentId
  } = options

  // get comments
  const comments = await pgdb.public.comments.find({
    discussionId: discussion.id
  })

  const rootComment = parentId
    ? { id: parentId }
    : {}

  // prepare sort
  let ascDesc = orderDirection === 'ASC'
    ? ascending
    : descending
  let compare
  if (orderBy === 'DATE') {
    compare = (a, b) => ascDesc(a.createdAt, b.createdAt)
  } else if (orderBy === 'VOTES') {
    compare = (a, b) => ascDesc(a.upVotes - a.downVotes, b.upVotes - b.downVotes)
  } else if (orderBy === 'HOT') {
    compare = (a, b) => ascDesc(a.hottnes, b.hottnes)
  }

  const coveredComments = assembleTree(rootComment, comments, afterId, compare)
  measureTree(rootComment)
  sortTree(rootComment, compare)

  if (first || focusId) {
    let filterCommentIds

    if (focusId) {
      const focusComment = coveredComments
        .find(c => c.id === focusId)

      const focusLevelComments = coveredComments
        .filter(c => c.parentId === focusComment.parentId && c._depth === focusComment._depth)
        .sort(compare)

      const focusIndex = focusLevelComments
        .findIndex(c => c.id === focusId)

      filterCommentIds = [
        ...focusLevelComments
          .slice(focusIndex - 1, focusIndex + 2),
        ...coveredComments
          .filter(c => c.parentId === focusId)
          .slice(0, 1)
      ]
        .sort(compare)
        .map(c => c.id)
    } else if (first) {
      filterCommentIds = coveredComments
        .filter(c => !maxDepth || c._depth < maxDepth)
        .sort(compare)
        .slice(0, first)
        .map(c => c.id)
    }

    filterTree(rootComment, filterCommentIds, {
      orderBy,
      orderDirection
    })
  }

  if (maxDepth != null) {
    cutTreeX(rootComment, maxDepth)
  }

  await decorateTree(rootComment, coveredComments, user, pgdb, t)

  return rootComment.comments
}