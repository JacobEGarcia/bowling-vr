# LAST FRAME

A midnight bowling lane in WebXR. One lane, ten frames, no crowd.

**Play:** https://jacobegarcia.github.io/bowling-vr/

## Quest 3

Open the page in the headset browser, tap ENTER VR.

- Grip or trigger near the ball to grab it
- Swing your arm and release to throw - release speed and direction carry through
- Left stick moves on the approach, right stick snap-turns
- Pull a trigger after game over to start a new game

## Desktop

- Click PLAY ON DESKTOP (pointer lock)
- WASD to move on the approach, mouse to look
- Click the ball to pick it up, flick the mouse and release the button to throw
- Flick left/right to put hook on the ball
- N skips a dead ball, Enter starts a new game after the tenth frame

## Details

- Full ten-frame scoring with strikes, spares, and a three-ball tenth
- Custom ball and pin physics: pin-to-pin chain reactions, gutters, hooks, dead wood, sweeper and re-rack
- WebAudio synth sound: lane rumble, pin clatter, sweeper
- Single-page static site: `index.html` + `main.js` + self-hosted Three.js (`three.module.js`, r160). No CDN, no network dependencies, no build step.
