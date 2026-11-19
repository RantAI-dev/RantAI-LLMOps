/** `node deployer/duo-deployer.cjs`: see ./server.ts. */
import { createDeployerServer } from "./server";

const token = process.env.DUO_DEPLOYER_TOKEN ?? "";
if (token.length < 24) {
  console.error("DUO_DEPLOYER_TOKEN must be set (at least 24 characters)");
  process.exit(1);
}
const port = Number(process.env.PORT ?? 8097);
createDeployerServer(token).listen(port, "0.0.0.0", () => console.log(`duo-deployer listening on :${port}`));
