module.exports = `

schema {
  query: queries
  mutation: mutations
}

type queries {
  crowdfundings: [Crowdfunding]
  crowdfunding(name: String!): Crowdfunding!
  pledges: [Pledge!]!
  pledge(id: ID!): Pledge
  draftPledge(id: ID!): Pledge!
}

type mutations {
  submitPledge(pledge: PledgeInput): PledgeResponse!
  payPledge(pledgePayment: PledgePaymentInput): PledgeResponse!
  reclaimPledge(pledgeId: ID!): Boolean!
  claimMembership(voucherCode: String!): Boolean!

  submitPaymentSource(method: PaymentMethod, sourceId: String!, pspPayload: String): PaymentSource!
  cancelMembership(id: ID!, reason: String): Membership!

  #reactivateMembership(id: ID!): ReactivateMembershipResponse!

  # throws if paymentSource is required
  # throws if charge is impossible
  reactivateMembership(id: ID!): Membership!
}
`
