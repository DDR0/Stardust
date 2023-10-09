import {bindWorldToDisplay} from './ui.mjs'

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

const world = (()=>{
	const world = Object.seal({
		__proto__: null,
		lock:              [Int32Array    , 1          ], //Global lock for all world data, so we can resize the world. Also acts as a "pause" button. Bool, but atomic operations like i32.
		tick:              [BigInt64Array , 1          ], //Current global tick.
		workersRunning:    [Int32Array    , 1          ], //Used by workers, last one to finish increments tick.
		 
		bounds: Object.seal({ 
			__proto__: null,
			x:             [Int32Array    , 1          ], 
			y:             [Int32Array    , 1          ],
		}),
		wrappingBehaviour: [Uint8Array    , 4          ], //top, left, bottom, right: Set to particle type 0 or 1.
		
		particles: Object.seal({
			__proto__: null,
			lock:          [Int32Array    , totalPixels], //Is this particle locked for processing? 0=no, >0 = logic worker, -1 = main thread, -2 = render worker
			type:          [Uint8Array    , totalPixels],
			tick:          [BigInt64Array , totalPixels], //Last tick the particle was processed on. Used for refilling initiatiave.
			initiative:    [Float32Array  , totalPixels], //Faster particles spend less initiative moving around. When a particle is out of initiatiave, it stops moving.
			abgr:          [Uint32Array   , totalPixels],
			velocity: Object.seal({
				__proto__: null,
				x:         [Float32Array  , totalPixels],
				y:         [Float32Array  , totalPixels],
			}),
			subpixelPosition: Object.seal({ 
				__proto__: null,
				x:         [Float32Array  , totalPixels], //Position comes in through x/y coordinate on screen, but this does not capture subpixel position for slow-moving particles.
				y:         [Float32Array  , totalPixels],
			}),
			mass:          [Float32Array  , totalPixels],
			temperature:   [Float32Array  , totalPixels], //Kelvin
			scratch1:      [BigUint64Array, totalPixels], //internal state for the particle
			scratch2:      [BigUint64Array, totalPixels],
		})
	})
	
	
	const walkWorldTree = (obj, hydrator=()=>{}, start=0) =>
		Object.entries(obj).reduce(
			(accum, [key, val]) => {
				if (val instanceof Array) {
					const [type, entries] = val
					const entryStartByte = Math.ceil(accum/type.BYTES_PER_ELEMENT) * type.BYTES_PER_ELEMENT //Align access for 2- and 4-byte types.
					hydrator(obj, key, type, entryStartByte, entries)
					return entryStartByte + type.BYTES_PER_ELEMENT * entries
				} else {
					return walkWorldTree(val, hydrator, accum)
				}
			},
			start
		)
	
	const memory = Object.freeze(new SharedArrayBuffer(walkWorldTree(world)))
	Object.freeze(walkWorldTree(world, (obj, key, type, entryStartByte, entries) =>
		obj[key] = new type(memory, entryStartByte, entries)
	))

	//Enable easy script access for debugging.
	if (localStorage.devMode) {
		window.world = world
		window.memory = memory
	}
	
	return Object.freeze(world);
})()

Array.prototype.fill.call(world.wrappingBehaviour, 1) //0 is air, 1 is wall. Default to wall. See particles.rs:hydrate_with_data() for the full list.



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
	if (
		!Atomics.load(world.lock, 0) &&
		Atomics.compareExchange(world.workersRunning, 0, 0, availableCores) === 0
	) {
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
	test: (...args) => renderCore.postMessage({type:'drawTest', data:args}),
})

console.info('Bound UI elements.')
