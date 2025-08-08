const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    // Frappe user id (usually the user's name in Frappe)
    frappeUserId: { type: String, index: true },
    // Keep both fullname and fullName for compatibility with existing populates
    fullname: { type: String, trim: true },
    fullName: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true, index: true },
    avatarUrl: { type: String, trim: true },
    // Optional fields for roles/permissions
    role: { type: String, trim: true },
    roles: [{ type: String, trim: true }],
    // Optional Frappe extras
    name: { type: String, trim: true },
    department: { type: String, trim: true },
    designation: { type: String, trim: true },
    mobileNo: { type: String, trim: true },
    phone: { type: String, trim: true },
  },
  { timestamps: true }
);

// Indexes for lookup performance
userSchema.index({ email: 1 });
userSchema.index({ frappeUserId: 1 });

/**
 * Update or create a local user document from a Frappe user payload
 * @param {object} frappeUser - The user object returned by Frappe
 * @returns {Promise<mongoose.Document>} Updated/created user
 */
userSchema.statics.updateFromFrappe = async function updateFromFrappe(frappeUser) {
  if (!frappeUser || typeof frappeUser !== 'object') {
    throw new Error('Invalid Frappe user payload');
  }

  const frappeUserId = frappeUser.name || frappeUser.user || frappeUser.email;
  const fullName =
    frappeUser.full_name ||
    frappeUser.fullname ||
    frappeUser.fullName ||
    [frappeUser.first_name, frappeUser.middle_name, frappeUser.last_name]
      .filter(Boolean)
      .join(' ') ||
    frappeUser.name;

  const email = frappeUser.email || frappeUser.user_id || frappeUser.username || undefined;
  const avatarUrl = frappeUser.user_image || frappeUser.avatar || frappeUser.avatar_url || undefined;

  const roles = Array.isArray(frappeUser.roles)
    ? frappeUser.roles.map((r) => (typeof r === 'string' ? r : r?.role)).filter(Boolean)
    : Array.isArray(frappeUser.roles_list)
    ? frappeUser.roles_list
    : undefined;

  const update = {
    frappeUserId,
    fullname: fullName,
    fullName: fullName,
    email,
    avatarUrl,
    role: frappeUser.role || undefined,
    roles,
    name: frappeUser.name,
    department: frappeUser.department || undefined,
    designation: frappeUser.designation || undefined,
    mobileNo: frappeUser.mobile_no || undefined,
    phone: frappeUser.phone || undefined,
    updatedAt: new Date(),
  };

  // Choose a stable identifier for upsert
  const query = email ? { email } : { frappeUserId };

  const options = { upsert: true, new: true, setDefaultsOnInsert: true };
  const doc = await this.findOneAndUpdate(query, update, options);
  return doc;
};

module.exports = mongoose.model('User', userSchema);


