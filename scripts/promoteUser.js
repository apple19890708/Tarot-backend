// 把某個 email 的使用者改成 admin（或用 --demote 改回 member）。
// 用法：npm run user:promote -- someone@example.com
//      npm run user:promote -- someone@example.com --demote
require('dotenv').config()

const mongoose = require('mongoose')

const User = require('../src/models/User')

async function main() {
  const args = process.argv.slice(2)
  const email = (args.find((item) => !item.startsWith('--')) || '').trim().toLowerCase()
  const role = args.includes('--demote') ? 'member' : 'admin'

  if (!email) {
    console.error('用法：npm run user:promote -- <email> [--demote]')
    process.exitCode = 1
    return
  }

  const mongoUri = process.env.MONGO_URI
  if (!mongoUri) {
    console.error('MONGO_URI 未設定。')
    process.exitCode = 1
    return
  }

  await mongoose.connect(mongoUri, { dbName: process.env.MONGO_DB_NAME || 'tarot-divination' })

  try {
    const user = await User.findOneAndUpdate({ email }, { role }, { returnDocument: 'after' })
    if (!user) {
      console.error(`找不到使用者：${email}`)
      process.exitCode = 1
      return
    }
    console.log(`${user.email} 的角色已改為 ${user.role}。`)
    console.log('提醒：他身上已經簽發的 token 還是舊角色，要重新登入才會更新。')
  } finally {
    await mongoose.disconnect()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
