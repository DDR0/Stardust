import {colour as flip} from './colour.mjs'
import {setWorld, summonParticle, indexOf} from './particles.mjs'

const useAtomicFrees = false;

const thisWorkerID = -2 //-2 for render worker, -1 for main thread, 0 for unclaimed, ≥1 for logic workers
let world

const callbacks = {
	__proto__: null,
	hello: ()=>{console.log('render worker hello')},
	bindToData: new_world => {
		world = new_world
		setWorld(world)
	},
}

addEventListener("message", ({'data': {type, data}}) => {
	const callback = callbacks[type]
	if (!callback) { return console.error(`Unknown worker event '${type}'.`) }
	//console.info('render worker msg', type, data)
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



callbacks['drawTest'] = (x,y) => {
	//Don't think we need to lock this, do we?
	summonParticle(world, 2, x, y)
}
callbacks['drawDot'] = (x,y, radius, id) => {
	const i = indexOf(world, x, y)
	
	if (!Atomics.compareExchange(
		world.particles.lock, 
		i, 0, thisWorkerID
	)) {
		summonParticle(world, id, x, y) //todo: radius
		useAtomicFrees
			? Atomics.store(world.particles.lock, i, 0)
			: world.particles.lock[i] = 0
	}
}