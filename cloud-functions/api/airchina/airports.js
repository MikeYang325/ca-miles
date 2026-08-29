import legacyHandler from '../../legacy/airchina/airports.js';
import { runLegacy } from './_legacy.js';

export default function onRequest({ request }) {
  return runLegacy(legacyHandler, request);
}
