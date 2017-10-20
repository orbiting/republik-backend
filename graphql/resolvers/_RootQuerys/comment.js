module.exports = async (_, { id }, { pgdb }) =>
  pgdb.public.comments.findOne({ id })
