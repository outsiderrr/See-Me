// Production entrypoint. server.ts's self-start guard can't be trusted
// (import.meta.url vs argv path mismatches under tsx), so call it explicitly.
import { startServer } from './server';

startServer();
