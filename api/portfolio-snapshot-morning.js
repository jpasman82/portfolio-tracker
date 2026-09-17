import { handleMorning } from '../server/closing/morning-http.js';

export default async function handler(req, res) {
  return handleMorning(req, res);
}
