import {colour as flip} from './colour.mjs'

const thisWorkerID = -2 //-2 for render worker, -1 for main thread, 0 for unclaimed, ≥1 for logic workers
let world

const callbacks = {
	__proto__: null,
	hello: ()=>{console.log('render worker hello')},
	bindToData: new_world => {world = new_world},
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

const i = (x,y) => x + y * world.bounds.x[0]

callbacks['drawTest'] = (x,y) => {
	world.particles.type[i(x,y)] = 1
	world.particles.abgr[i(x,y)] = flip(0x00FF0044)
}