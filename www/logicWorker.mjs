(async ()=>{ //shim file not getting loaded as a javascript module

const requestFramerateCallback = self.requestAnimationFrame ?? (cb=>setTimeout(cb, 16)) //16ms: Default to a 60fps timeout if we can't hook into the animation callback.
const cancelFramerateCallback = self.cancelAnimationFrame ?? clearTimeout
if (!self.requestAnimationFrame) {
	console.warn("requestAnimationFrame unavailable; falling back to setTimeout. Motion may be rougher.")
}

let thisWorkerIndex = 0
let totalWorkers = 1
let thisWorkerID = -1
let world

const callbacks = Object.freeze({
	__proto__: null,
	
	hello: _=>{
		console.log('logic worker hello');
	},
	
	start: (_thisWorkerIndex, _totalWorkers, _world) => {
		thisWorkerIndex = _thisWorkerIndex
		totalWorkers = _totalWorkers
		thisWorkerID = _thisWorkerIndex + 1
		world = _world
		
		console.log(`Logic worker ${thisWorkerID}/${totalWorkers} started.`)
		processFrame()
	},
})

addEventListener("message", ({'data': {type, data}}) => {
	const callback = callbacks[type]
	if (!callback) { return console.error(`Unknown worker event '${type}'.`) }
	
	//console.info('logic worker msg', type, data)
	
	try {
		const retval = callback(...(data??[]))
		if (retval !== undefined) {
			postMessage({ type, data: retval })
		}
	}
	catch (err) {
		console.error(err)
		postMessage({ type, error: err.message })
	}
})

postMessage({ type:'ready' }) //Let the main thread know this worker is up, ready to receive data.



let lastFrameTime = 0;
function processFrame() {
	//return; //Don't process at all for debugging.
	
	Atomics.add(world.workersRunning, 0, 1) //Can't use a bitmask directly because may have >32 cores, would have to bin.
	const currentTick = Atomics.load(world.tick, 0)
	//console.log(`#${thisWorkerID} working on tick ${currentTick}`)
	
	const thisFrameTime = performance.now()
	//Minimum and maximum framerate delta within which to try to run the simulation.
	const timeDelta = Math.max(1000/500, Math.min(thisFrameTime - lastFrameTime, 1000/10))
	lastFrameTime = thisFrameTime
	
	let delta = thisWorkerID % 2 ? 1 : -1;
	let x = delta > 0 ? 0 : world.bounds.x[0]-1;
	let y = delta > 0 ? 0 : world.bounds.y[0]-1;
	let stage = 0; //0: Try to move where you ideally want to. 1: (Disabled for now.) Move where you can.
	const numStages = 1; //The first stage is stage 0, like with arrays.
	const worldX = world.bounds.x[0];
	const worldY = world.bounds.y[0];
	let iterCounter = 1;
	let didProcessParticle = 0;
	const iterationLimit = 100;
	
	// The Two Stages of Particle Logic (each stage is resolved iteratively)
	// 1. Can we do the move we would ideally like to?
	// 2. Can we do any move?
	
	while (1) {
		didProcessParticle |= processParticle(world, thisWorkerID, x, y) //Don't forget time_delta!
		
		//Check if we're at bounds.
		if (x + delta < 0 || x + delta >= worldX) { //OK, we're off the end of a row.
			if (y + delta < 0 || y + delta >= worldY) { //We're off the end of a column too.
				if (iterCounter >= iterationLimit) break
				if (!didProcessParticle) { //Nothing happened this iteration.
					stage++
					if (stage >= 1) {
						break
					}
				}
				iterCounter++
				didProcessParticle = 0
				delta = -delta //Iterate in reverse now.
			} else {
				y = y + delta
				x = x - (worldX*delta) + delta
			}
		} else {
			x = x + delta
		}
	}
	
	//Next steps:
	Atomics.sub(world.workersRunning, 0, 1)
	
	//Iterate only once, for testing purposes.
	//return
	
	//console.log(`#${thisWorkerID} done tick ${currentTick}`)
	if (Atomics.waitAsync) {
		Promise.resolve(
			Atomics.waitAsync(world.tick, 0, currentTick).value
		).then(processFrame)
		Atomics.sub(world.workersRunning, 0, 1)
	} else {
		Atomics.sub(world.workersRunning, 0, 1)
		Atomics.wait(world.tick, 0, currentTick)
		Promise.resolve().then(processFrame)
	}
}

})() //end shim