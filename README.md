# craftax-crystal

Crystal players for [Craftax 3D](https://github.com/delaurentis/craftax-3d). A crystal is a trained piece of optical glass: light goes in as a picture of the game and comes out as the move to make. This plugin simulates the glass in your browser on WebGPU, with the [`neuralcrystal`](https://github.com/neuralcrystal/neuralcrystal-typescript) package, and lets it play.

It adds four things to the game:

- **Players.** The crystals in `src/crystal/models.json` appear in the bot picker (by default only with `?crystal` in the address). Each plays in its own worker and sees the game as the picture it was trained on.
- **What the crystal sees.** In the classic view, the laser look shows that picture, the lit mirrors red on black, with the crystal's memory drawn in while it plays.
- **Its own brain view.** While a crystal plays, the bot panel shows what went in, what lit up inside the glass and what came out, instead of the usual neuron brain.
- **Its memory strip.** In the classic view (original art or laser), panels down both sides show the crystal's memory, every unit's level after each move, the ones the move changed flashing. Y turns it off and on.

Each family of crystals brings its own frame art (`src/crystal/frame-atlas.json` and `frame.js`), so a new kind of crystal with a different picture is a new entry here, never a change to the game.

## Add it to the game

In your copy of craftax-3d:

    npm install craftax-crystal

Then list it in craftax-3d's `craftax.config.ts`:

    import crystal from "craftax-crystal";

    export default {
      site: "https://playcraftax.com",
      plugins: [crystal()],
    };

To work on the plugin itself, clone it beside craftax-3d in a workspace, as craftax-3d's [Run it](https://github.com/delaurentis/craftax-3d#run-it) shows, so the game uses this checkout. Then run craftax-3d with this folder's config:

    cd ../craftax-3d
    CRAFTAX_CONFIG=../craftax-crystal/craftax.config.ts npm run dev     # then open /?crystal

The crystals' weights are large and are not in this repository; put them in craftax-3d's `public/agent/crystal/`, as each model's `crystal` path says.

## License

MIT. See [LICENSE](LICENSE). The crystals run on the NeuralCrystal engine, the MIT-licensed [`neuralcrystal`](https://www.npmjs.com/package/neuralcrystal) package on npm.
