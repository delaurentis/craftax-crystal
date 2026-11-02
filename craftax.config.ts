// For working on the plugin: craftax-3d with the crystal players in it (the two checkouts side by side in a workspace).
//   cd ../craftax-3d && CRAFTAX_CONFIG=../craftax-crystal/craftax.config.ts npm run dev     then open /?crystal
import type { CraftaxConfig } from "craftax-3d/src/config";
import crystal from "./src/index";

const config: CraftaxConfig = {
  site: "https://playcraftax.com",
  plugins: [crystal()],
};

export default config;
