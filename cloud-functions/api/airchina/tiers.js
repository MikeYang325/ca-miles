import legacyHandler from '../../../api/airchina/tiers.js';
import { runLegacy } from './_legacy.js';

export default function onRequest({ request }) {
  return runLegacy(legacyHandler, request);
}
