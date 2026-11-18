import { handleApiRequest } from '../../cf-backend/router.js';

export async function onRequest(context) {
    return handleApiRequest(context.request, context.env);
}
