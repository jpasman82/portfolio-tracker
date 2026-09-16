import { handleClose } from '../server/closing/http.js';

export default function handler(req, res) {
  return handleClose(req, res, 'capture');
}
