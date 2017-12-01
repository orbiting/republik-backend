module.exports = `

scalar DateTime
scalar JSON

extend type User {
  pledges: [Pledge!]!
  memberships: [Membership!]!
  testimonial: Testimonial
  paymentSource: PaymentSource
}

type Crowdfunding {
  id: ID!
  name: String!
  beginDate: DateTime!
  endDate: DateTime!
  endVideo: Video
  hasEnded: Boolean!
  goals: [CrowdfundingGoal!]!
  status: CrowdfundingStatus!
  packages: [Package!]!
  createdAt: DateTime!
  updatedAt: DateTime!
}
type CrowdfundingGoal {
  money: Int!
  people: Int!
  description: String
}
type CrowdfundingStatus {
  money: Int!
  people: Int!
}

type Package {
  id: ID!
  name: String!
  options: [PackageOption!]!
  paymentMethods: [PaymentMethod!]!
  createdAt: DateTime!
  updatedAt: DateTime!
}

type PackageOption {
  id: ID!
  package: Package!
  reward: Reward
  minAmount: Int!
  maxAmount: Int
  defaultAmount: Int!
  price: Int!
  minUserPrice: Int!
  userPrice: Boolean!
  createdAt: DateTime!
  updatedAt: DateTime!

  amount: Int
  templateId: ID
}
input PackageOptionInput {
  amount: Int!
  price: Int!
  templateId: ID!
}

type Goodie {
  id: ID!
  name: String!
  createdAt: DateTime!
  updatedAt: DateTime!
}

type MembershipType {
  id: ID!
  name: String!
  duration: Int!
  createdAt: DateTime!
  updatedAt: DateTime!
}

type Membership {
  id: ID!
  type: MembershipType!
  pledge: Pledge!
  # createdAt desc
  payments: [Payment]!
  voucherCode: String
  reducedPrice: Boolean!
  claimerName: String
  sequenceNumber: Int
  active: Boolean!
  renew: Boolean!
  # createdAt desc
  periods: [MembershipPeriod]!
  createdAt: DateTime!
  updatedAt: DateTime!
}

type MembershipPeriod {
  id: ID!
  membership: Membership!
  beginDate: DateTime!
  endDate: DateTime!
  createdAt: DateTime!
  updatedAt: DateTime!
}

union Reward = Goodie | MembershipType

input UserInput {
  email: String!
  firstName: String!
  lastName: String!
  birthday: Date
  phoneNumber: String
}
#input AddressInput {
#  name: String!
#  line1: String!
#  line2: String
#  postalCode: String!
#  city: String!
#  country: String!
#}

enum PledgeStatus {
  DRAFT
  WAITING_FOR_PAYMENT
  PAID_INVESTIGATE
  SUCCESSFUL
  CANCELLED
}
type Pledge {
  id: ID!
  package: Package!
  options: [PackageOption!]!
  status: PledgeStatus!
  total: Int!
  donation: Int!
  payments: [Payments!]!
  user: User!
  reason: String
  memberships: [Membership!]!
  createdAt: DateTime!
  updatedAt: DateTime!
}

input PledgeInput {
  options: [PackageOptionInput!]!
  total: Int!
  user: UserInput!
  reason: String
}

type PledgeResponse {
  pledgeId: ID
  userId: ID
  emailVerify: Boolean
  pfAliasId: String
  pfSHA: String
}

input PledgePaymentInput {
  pledgeId: ID!
  method: PaymentMethod!
  paperInvoice: Boolean
  sourceId: String
  pspPayload: String
  address: AddressInput
}

enum PaymentMethod {
  STRIPE
  POSTFINANCECARD
  PAYPAL
  PAYMENTSLIP
}
enum PaymentStatus {
  WAITING
  PAID
  WAITING_FOR_REFUND
  REFUNDED
  CANCELLED
  FAILED
}
type Payment {
  id: ID!
  method: PaymentMethod!
  paperInvoice: Boolean!
  total: Int!
  status: PaymentStatus!
  hrid: String
  pspId: String
  dueDate: DateTime
  # every payment should link to
  # a user, but there is some cleanup
  # to do, to make that reality
  user: User
  remindersSentAt: [DateTime!]
  createdAt: DateTime!
  updatedAt: DateTime!
  # error by the psp
  error: String
}


type PaymentSource {
  method: PaymentMethod!
  expire: Date!
  # cc: last4
  identifier: String!
}

#ReactivateMembershipResponse {
#  requiresPaymentSource: [PaymentMethod!]
#  paymentError: String
#
#  membership: Membership
#}
`
