# Alps to Tokyo Motor Club

An offline 3D driving game set across Chamonix and Tokyo. Pick a vehicle from the garage, follow the mountain roads into the city, or start on foot and invite your companion along for a drive.

[Download the game ZIP](https://chatgpt.com/library?file_id=libfile_db9e1ef7a17c8191a819e76f511f91d4)

## Quick start

1. Extract the entire ZIP.
2. Open `index.html` from the extracted folder in Chrome or Edge. The game uses WebGL 2 and runs offline.
3. Use the driver button at the lower left to choose **Players** to select a vehicle.
4. Choose **Play** to start in your selected vehicle 
To reach Tokyo, follow the signs at the village junction and continue across the connector. Press **M** for a wider minimap view.

## Controls

| Key | Action |
| --- | --- |
| **W / ↑** | Accelerate |
| **S / ↓** | Brake. Hold from a stop to reverse. |
| **A / D** or **← / →** | Steer |
| **Space** | Handbrake |
| **E** | Enter a nearby vehicle or get out when stopped |
| **V** | Cycle through Chase, Hood, Cabin, and Wide cameras |
| **C** | Toggle the rear-facing camera |
| **M** | Change minimap zoom |
| **WASD** or **arrow keys** on foot | Walk |
| **Shift** on foot | Sprint |
| **Mouse drag** on foot | Orbit the camera |
| **F** on foot | Interact with your nearby companion |
| **Esc** | Pause or go back |
| **Enter** | Skip the intro or confirm the selected vehicle in the garage |


## Garage and vehicles

| Vehicle | Ride type | Drive-date passenger support |
| --- | --- | --- |
| Ferrari F8 Tributo | Supercar | Yes |
| Bugatti Divo | Hypercar | Yes |
| McLaren Ultimate Vision GT | Single-seat concept | Solo |
| Vision 1789 | Prototype hypercar | Solo |
| Hummer HX | Off-road SUV | Yes |
| Yamaha MT-09 SP | Motorcycle | Solo |
| Quad Bike | ATV | Solo |

Traffic follows lanes and reacts to stopped vehicles. A dog patrols the pavement beside the garage. Unoccupied vehicles return to their bays when you leave the garage.

## Settings and troubleshooting

- If the game stutters, try **Settings → Graphics → Performance**. **Balanced** and **High** use higher rendering resolutions.
- If the screen stays blank, check that the ZIP is fully extracted and that your browser supports WebGL 2. Keep `index.html`, `game.js`, `style.css`, and the `packed/` folder together.
- If a companion won’t board, check that you chose **Ask for a drive date** and are entering one of the three supported vehicles.

## Rebuild from source

The packaged game is ready to play. To edit and rebuild it, run these commands from the extracted game folder using Node.js and npm:

```sh
cd source
npm install --no-save three@0.180.0 esbuild@0.25.11
npx esbuild main.js --bundle --minify --outfile=../game.js --format=iife --target=es2022 --legal-comments=eof
```

`source/` contains the editable JavaScript, including the driving physics, traffic, and companion interactions. `packed/` contains the bundled world, vehicle, and character assets. The game uses the supplied project assets, and the Three.js license is included at `source/THREE-LICENSE.txt`.
