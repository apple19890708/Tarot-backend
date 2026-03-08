const mongoose = require('mongoose')

const cardSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true },
    nameZh: { type: String, required: true },
    nameEn: { type: String, default: '' },
    arcanaType: { type: String, enum: ['major', 'minor'], required: true },
    suit: { type: String, default: null },
    number: { type: Number, required: true },
    source: { type: String, default: '' },
    filePath: { type: String, required: true },
    keywords: { type: [String], default: [] },
    summary: { type: String, default: '' },
    sections: { type: Object, default: {} },
  },
  {
    timestamps: true,
  },
)

module.exports = mongoose.model('Card', cardSchema)