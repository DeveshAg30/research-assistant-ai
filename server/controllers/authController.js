const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const settings = require('../config/settings');
const HttpError = require('../utils/httpError');
const { getTodayUsage } = require('../services/usage');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12;
// Compared against when the email is unknown, so timing doesn't reveal it.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), email: user.email }, settings.JWT_SECRET, {
    expiresIn: settings.JWT_EXPIRES_IN,
  });
}

function readCredentials(body = {}) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!EMAIL_RE.test(email) || email.length > 254) {
    throw new HttpError(400, 'VALIDATION', 'Please enter a valid email address.');
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
    throw new HttpError(400, 'VALIDATION', `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  return { email, password };
}

/** POST /api/auth/register */
const register = asyncHandler(async (req, res) => {
  const { email, password } = readCredentials(req.body);
  if (await User.exists({ email })) {
    throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
  }
  const user = await User.create({ email, passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) });
  res.status(201).json({ token: signToken(user), user: user.toPublic() });
});

/** POST /api/auth/login */
const login = asyncHandler(async (req, res) => {
  const { email, password } = readCredentials(req.body);
  const user = await User.findOne({ email });
  const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
  if (!user || !ok) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  }
  res.json({ token: signToken(user), user: user.toPublic() });
});

/** GET /api/auth/me */
const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Your account no longer exists.');
  res.json({ user: user.toPublic(), usage: await getTodayUsage(req.user.id) });
});

module.exports = { register, login, me };
