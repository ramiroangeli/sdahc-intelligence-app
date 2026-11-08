import { draftPhotosRoute } from '../_lib/routes.js';

// The image body is read raw (not parsed), up to 4 MB.
export const config = { api: { bodyParser: false } };
export default draftPhotosRoute();
