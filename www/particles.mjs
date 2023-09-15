import {colour as flip} from './colour.mjs'

const debug = true
const overwrite = false

const tr=x=>x; //TODO?

const particleData = Object.freeze({ //particle data
	__proto__: null,
	0: {
		name: tr('air'),
		desc: tr('Your standard one bar of atmosphere. (You\'re soaking in it.)'),
		colour: 0,
		variation: 0,
		mass: 1.293, //kg/m³,
		create: ()=>{},
		move: ()=>{},
	},
	1: {
		name: tr('wall'),
		desc: tr('An intert, indestructable barrier.'),
		colour: flip(0x555555FF),
		variation: 0,
		mass: Infinity,
		create: ()=>{},
		move: ()=>{},
	},
	2: {
		name: tr('sand'),
		desc: tr('A thin silica powder, such as might be found on a tropical beach. Gets into everything!'),
		colour: flip(0xFBDFB3FF),
		variation: 0x05220A00, //hsv
		mass: 1682,
		create: ()=>{},
		move: ()=>{},
	},
})

const indexOf = (world, x,y) => x + y * world.bounds.x[0]

const ADVANCED_GAME_STATE = { NO: 0, YES: 1 }

//May lock additional particles as part of the processing.
export const processParticle = (world, workerID, x, y) => {
	return ADVANCED_GAME_STATE.NO;
}

//Does not lock particle - this must be done beforehand, and undone afterhand.
export const summonParticle = (world, type, x, y) => {
	const parts = world.particles
	const part = particleData[type]
	const i = indexOf(world, x,y)
	
	if (debug && !part) {
		throw new Error(`unknown particle ID ${type} summoned at ${x},${y}`)
	}
	
	if (!overwrite) {
		if(parts.type[i] === type) return ADVANCED_GAME_STATE.NO
	}
	
	parts.type[i] = type
	parts.initiative[i] = 0
	parts.abgr[i] = part.colour //todo: add variation here
	parts.velocity.x[i] = 0
	parts.velocity.y[i] = 0
	parts.subpixelPosition.x[i] = 0.5
	parts.subpixelPosition.y[i] = 0.5
	parts.mass[i] = part.mass
	parts.temperature[i] = 295, //°K, ~21°C
	part.create(parts, i)
	
	return ADVANCED_GAME_STATE.YES;
}