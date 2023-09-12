import {bindWorldToDisplay} from './ui.mjs'
import {colour} from './colour.mjs'

if (!window.SharedArrayBuffer) {
	document.body.innerHTML = `
		<div>
			<h1>Software Failure</h1>
			<p>Your browser does not appear to support shared array buffers, which are required by <em>Stardust</em>. Perhaps try another one?</p>
			<p>Guru Meditation 0x${(!!Atomics.waitAsync << 2 | crossOriginIsolated << 1 | isSecureContext << 0).toString(16).toUpperCase().padStart(2, '0')}</p>
		</div>
	`
	throw new ReferenceError('SharedArrayBuffer is not defined.')
}

if (!Atomics.waitAsync) { //Firefox doesn't support asyncWait as of 2023-01-28.
	console.warn('Atomics.waitAsync not available; glitching may occur when resized.')
}

const $ = document.querySelector.bind(document);
const $$ = document.querySelectorAll.bind(document);

const gameDisplay = $("#stardust-game")

const defaultHardwareConcurrency = 4;
const reservedCores = 2; //One for main thread, one for the render thread; the rest are used for processing. This means at minimum we run with 3 threads, even if we're on a single-core CPU.
//Note: Safari doesn't support hardwareConcurrency as of 2022-06-09.
const availableCores = 
	(+localStorage.coreOverride)
	|| Math.max(//Available cores for _processing,_ at least 1.
		1, 
		(navigator.hardwareConcurrency || defaultHardwareConcurrency) - reservedCores
	);

const maxScreenRes = Object.freeze({ x: 3840, y: 2160 }) //4k resolution, probably no sense reserving more memory than that especially given we expect to scale up our pixels.
const totalPixels = maxScreenRes.x * maxScreenRes.y
const renderBuffer = new Uint8Array(new SharedArrayBuffer(totalPixels * Uint8Array.BYTES_PER_ELEMENT * 3)) //rgb triplets (no a?) - drawn to canvas to render the game

//Could use a double-buffer system, but we would have to copy everything from one buffer to the other each frame. Benefit: no tearing.
const world = Object.freeze({
	__proto__: null,
	version:           1,
	lock:              new Int32Array(new SharedArrayBuffer(1 * Int32Array.BYTES_PER_ELEMENT)), //Global lock for all world data, so we can resize the world. Also acts as a "pause" button. Bool, but atomic operations like i32.
	tick:              new BigInt64Array(new SharedArrayBuffer(1 * BigInt64Array.BYTES_PER_ELEMENT)), //Current global tick.
	
	workersRunning:    new Int32Array(new SharedArrayBuffer(1 * Int32Array.BYTES_PER_ELEMENT)), //Used by workers, last one to finish increments tick.
	
	bounds: Object.seal({ 
		__proto__: null,
		x:             new Int32Array(new SharedArrayBuffer(1 * Int32Array.BYTES_PER_ELEMENT)), 
		y:             new Int32Array(new SharedArrayBuffer(1 * Int32Array.BYTES_PER_ELEMENT)),
	}),
	wrappingBehaviour: new Uint8Array(new SharedArrayBuffer(4 * Uint8Array.BYTES_PER_ELEMENT)), //top, left, bottom, right: Set to particle type 0 or 1.
	
	particles: Object.freeze({
		__proto__: null,
		lock:        new Int32Array    (new SharedArrayBuffer(totalPixels * Int32Array.    BYTES_PER_ELEMENT)), //Is this particle locked for processing? 0=no, >0 = logic worker, -1 = main thread, -2 = render worker
		type:        new Uint8Array    (new SharedArrayBuffer(totalPixels * Uint8Array.    BYTES_PER_ELEMENT)),
		initiative:  new Float32Array  (new SharedArrayBuffer(totalPixels * Float32Array.  BYTES_PER_ELEMENT)), //Faster particles get more initiative to spend moving around.
		abgr:        new Uint32Array   (new SharedArrayBuffer(totalPixels * Uint32Array.   BYTES_PER_ELEMENT)),
		velocity: {
			__proto__: null,
			x:       new Float32Array  (new SharedArrayBuffer(totalPixels * Float32Array.  BYTES_PER_ELEMENT)),
			y:       new Float32Array  (new SharedArrayBuffer(totalPixels * Float32Array.  BYTES_PER_ELEMENT)),
		},
		subpixelPosition: { 
			__proto__: null,
			x:       new Float32Array  (new SharedArrayBuffer(totalPixels * Float32Array.  BYTES_PER_ELEMENT)), //Position comes in through x/y coordinate on screen, but this does not capture subpixel position for slow-moving particles.
			y:       new Float32Array  (new SharedArrayBuffer(totalPixels * Float32Array.  BYTES_PER_ELEMENT)),
		},
		mass:        new Float32Array  (new SharedArrayBuffer(totalPixels * Float32Array.  BYTES_PER_ELEMENT)),
		temperature: new Float32Array  (new SharedArrayBuffer(totalPixels * Float32Array.  BYTES_PER_ELEMENT)), //Kelvin
		scratch1:    new BigUint64Array(new SharedArrayBuffer(totalPixels * BigUint64Array.BYTES_PER_ELEMENT)), //internal state for the particle
		scratch2:    new BigUint64Array(new SharedArrayBuffer(totalPixels * BigUint64Array.BYTES_PER_ELEMENT)),
	})
})

window.world = world //Enable easy script access for debugging.

Array.prototype.fill.call(world.wrappingBehaviour, 1) //0 is air, 1 is wall. Default to wall. See particles.rs:hydrate_with_data() for the full list.

world.particles.type[0] = 1
world.particles.abgr[0] = colour(0x00FF0088)


//new Uint8ClampedArray(world.particles.rgba.buffer, 0, 100)
//	.set([255,0,0,255, 0,255,0,255, 0,0,255,255, 0,0,0,255])

///////////////////////
//  Set up workers.  //
///////////////////////

const pong = val => { console.log('pong', val) }

const callbacks = { ok: Object.create(null), err: Object.create(null) } //Default, shared callbacks.
callbacks.ok.hello = pong
//callbacks.ok.update = graphUi.repaint
callbacks.ok.pong = pong


//Wrap a worker for our error-handling callback style, ie, callbacks.ok.whatever = ()=>{}.
function wrapForCallbacks(worker, callbacks) {
	worker.addEventListener('message', ({'data': {type, data, error}}) => {
		if (error !== undefined && data !== undefined)
			return console.error(`malformed message '${type}', has both data and error`)
		
		const callback = 
			callbacks[error!==undefined?'err':'ok'][type]
			?? (error!==undefined 
				? console.error 
				: console.error(`Unknown main event '${error!==undefined?'err':'ok'}.${type}'.`) )
		callback(...(data ?? [error]))
	});
	
	return worker
}

const pendingLogicCores = Array(availableCores).fill().map((_,i)=>{
	return new Promise(resolve => {
		const worker = wrapForCallbacks(
			new Worker('logicWorker.mjs', {
				type: 'module',
				credentials: 'omit',
				name: `Logic Worker ${i}`
			}),
			{
				err: { ...callbacks.err }, 
				ok: {
					...callbacks.ok,
					ready: ()=>{
						resolve(worker)
						worker.postMessage({type:'hello', data:[]})
					},
				}
			},
		)
	});
})

const pendingRenderCore = new Promise(resolve => {
	const worker = wrapForCallbacks(
		new Worker('renderWorker.mjs', {
				type: 'module',
				credentials: 'omit',
				name: 'Render Worker 1'
			}),
		{
			err: { ...callbacks.err }, 
			ok: {
				...callbacks.ok,
				ready: ()=>{
					resolve(worker)
				}
			},
		}
	)
})

//Wait for our compute units to become available.
const logicCores = await Promise.allSettled(pendingLogicCores)
	.then(results => results
		.filter(result => result.status === "fulfilled")
		.map(result => result.value))


logicCores.forEach((core, coreNumber, cores) => core.postMessage({
	type: 'start',
	data: [coreNumber, cores.length, world],
}))

console.info(`Loaded ${logicCores.length}/${pendingLogicCores.length} logic cores.`)
if (!logicCores.length) {
	document.body.innerHTML = `
		<div>
			<h1>Software Failure</h1>
			<p>Failed to load any simulation cores. Perhaps try another browser?</p>
			<p>Guru Meditation 0x${(!!Atomics.waitAsync << 2 | crossOriginIsolated << 1 | isSecureContext << 0).toString(16).toUpperCase().padStart(2, '0')}</p>
		</div>
	`
	throw new Error('Failed to load any simulation cores.')
}



//Poke shared memory worker threads are waiting on, once per frame.
(function advanceTick() {
	if (Atomics.compareExchange(world.workersRunning, 0, 0, availableCores) === 0) {
		Atomics.add(world.tick, 0, 1n)
		Atomics.notify(world.tick, 0)
		//console.log('incremented frame')
	} else {
		//console.log('missed frame')
	}
	requestAnimationFrame(advanceTick)
})()



const renderCore = await pendingRenderCore
renderCore.postMessage({type:'hello', data:[]})
renderCore.postMessage({type:'bindToData', data:[world]})
console.info(`Loaded render core.`)



bindWorldToDisplay(world, gameDisplay, {
	dot:  (...args) => renderCore.postMessage({type:'drawDot',  data:args}),
	line: (...args) => renderCore.postMessage({type:'drawLine', data:args}),
	rect: (...args) => renderCore.postMessage({type:'drawRect', data:args}),
	fill: (...args) => renderCore.postMessage({type:'drawFill', data:args}),
})

console.info('Bound UI elements.')
