// The Listings endpoints, each built only through guardedRoute (authorisation first, always).
import { loadDataConfig } from './config.js';
import { buildListings } from './listings-service.js';
import { guardedRoute } from './guard.js';
import { CAPABILITIES } from './permissions.js';

export const listRoute = guardedRoute({
  capability: CAPABILITIES.VIEW,
  run: ({ deps }) => buildListings(deps.dataConfig ?? loadDataConfig(deps.env ?? process.env), { fetchImpl: deps.fetch ?? fetch }),
});

export const meRoute = guardedRoute({
  capability: CAPABILITIES.VIEW,
  run: ({ session }) => ({
    email: session.staff.email,
    capabilities: session.staff.capabilities,
    canEdit: session.staff.capabilities.includes(CAPABILITIES.EDIT),
    canPublish: session.staff.capabilities.includes(CAPABILITIES.PUBLISH),
  }),
});
