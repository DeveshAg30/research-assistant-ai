const mongoose = require('mongoose');
const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);

UserSchema.methods.toPublic = function toPublic() {
  return { id: this._id.toString(), email: this.email, createdAt: this.createdAt };
};

module.exports = mongoose.model('User', UserSchema);
