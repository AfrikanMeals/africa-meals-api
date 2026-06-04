/**
 * Point d’entrée PM2 — enregistre tsconfig-paths puis charge le build Nest.
 */
require('tsconfig-paths/register');
require('../dist/main.js');
