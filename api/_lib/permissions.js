// Capabilities for the Listings Manager. Editor and Publisher are separate capabilities, so a person can hold
// either or both (Ali holds both). Presets exist only as documentation; authorisation always checks capabilities.

export const CAPABILITIES = Object.freeze({
  VIEW: 'listings.view',
  EDIT: 'listings.edit',
  PUBLISH: 'listings.publish',
  ADMIN: 'listings.admin',
});

export const ALL_CAPABILITIES = Object.freeze(Object.values(CAPABILITIES));

export const hasCapability = (staff, capability) => Array.isArray(staff?.capabilities) && staff.capabilities.includes(capability);
