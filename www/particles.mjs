import {colour as flip} from './colour.mjs'
import {rng} from './rng.mjs'

const debug = true
const overwrite = false
const useAtomicFrees = true;

const tr=str=>str; //TODO, translate?

let world
export const setWorld = newWorld => world = newWorld

export const indexOf = (world, x,y) => x + y * world.bounds.x[0]

//A real particle, in our world grid.
const realParticleOperator = Object.freeze({
	__proto__: null,
	toString: () => '{realParticleOperator}',
	get ok() { return this.i >= 0 },
	release: function() {
		useAtomicFrees
			? Atomics.store(world.particles.lock, this.i, 0)
			: world.particles.lock[this.i] = 0
	},
	
	get type() { return world.particles.type[this.i] },
	set type(v) { world.particles.type[this.i] = v },
	get tick() { return world.particles.tick[this.i] },
	set tick(v) { world.particles.tick[this.i] = v },
	get initiative() { return world.particles.initiative[this.i] },
	set initiative(v) { world.particles.initiative[this.i] = v },
	get abgr() { return world.particles.abgr[this.i] },
	set abgr(v) { world.particles.abgr[this.i] = v },
	velocity: Object.freeze({ 
		get x() { return world.particles.velocity.x[this.i] },
		set x(v) { world.particles.velocity.x[this.i] = v },
		get y() { return world.particles.velocity.y[this.i] },
		set y(v) { world.particles.velocity.y[this.i] = v },
	}),
	subpixelPosition: Object.freeze({
		get x() { return world.particles.subpixelPosition.x[this.i] },
		set x(v) { world.particles.subpixelPosition.x[this.i] = v },
		get y() { return world.particles.subpixelPosition.y[this.i] },
		set y(v) { world.particles.subpixelPosition.y[this.i] = v },
	}),
	get mass() { return world.particles.mass[this.i] },
	set mass(v) { world.particles.mass[this.i] = v },
	get temperature() { return world.particles.temperature[this.i] },
	set temperature(v) { world.particles.temperature[this.i] = v },
	get scratch1() { return world.particles.scratch1[this.i] },
	set scratch1(v) { world.particles.scratch1[this.i] = v },
	get scratch2() { return world.particles.scratch2[this.i] },
	set scratch2(v) { world.particles.scratch2[this.i] = v },
})

//A heap-allocated particle, outside the grid.
const freeParticleOperator = Object.freeze({
	__proto__: null,
	toString: () => '{freeParticleOperator}',
	get ok() { return true },
	release: ()=>{},
	get x() { throw new Error(`Invalid access on free particle x coordinate. (i: ${this.i})`) },
	get y() { throw new Error(`Invalid access on free particle y coordinate. (i: ${this.i})`) },
})


//A heap-allocated particle, outside the grid.
const fakeParticleOperator = Object.freeze({
	__proto__: null,
	toString: () => '{fakeParticleOperator}',
	ok: true,
	release: ()=>{},
	i: -1,
	
	get type() { 0 },
	set type(v) { },
	get tick() { return world.tick[0] },
	set tick(v) { },
	get initiative() { return 0 },
	set initiative(v) { },
	get abgr() { return 0 },
	set abgr(v) { },
	velocity: Object.freeze({ 
		get x() { return 0 },
		set x(v) { },
		get y() { return 0 },
		set y(v) { },
	}),
	subpixelPosition: Object.freeze({
		get x() { return 0 },
		set x(v) { },
		get y() { return 0 },
		set y(v) { },
	}),
	get mass() { return Infinity },
	set mass(v) { 0 },
	get temperature() { return 295 },
	set temperature(v) { },
	get scratch1() { return 0 },
	set scratch1(v) { },
	get scratch2() { return 0 },
	set scratch2(v) { },
})

const [tmp1, tmp2, tmp3] = [-2,-3,-4].map(i=>({
	__proto__: freeParticleOperator,
	i,
	
	type: 0,
	tick: 0n,
	initiative: 0,
	abgr: 0,
	velocity: { 
		x: 0,
		y: 0,
	},
	subpixelPosition: {
		x: 0,
		y: 0,
	},
	mass: 0,
	temperature: 0,
	scratch1: 0n,
	scratch2: 0n,
}))

const acquire = (workerID, x,y) => {
	if (x < 0) return ({
		__proto__: fakeParticleOperator,
		x, y, type: world.wrappingBehaviour[3]
	})
	
	if (x >= world.bounds.x[0]) return ({
		__proto__: fakeParticleOperator,
		x, y, type: world.wrappingBehaviour[1]
	})
		
	if (y < 0) return ({
		__proto__: fakeParticleOperator,
		x, y, type: world.wrappingBehaviour[0]
	})
	
	if (y >= world.bounds.y[0]) return ({
		__proto__: fakeParticleOperator,
		x, y, type: world.wrappingBehaviour[2]
	})

	return ({
		__proto__: realParticleOperator,
		x, y, i: Atomics.compareExchange(
			world.particles.lock, 
			indexOf(world, x,y), 0, workerID
		) ? -1 : indexOf(world, x,y),
	})
}

const threes_permute = 
	Object.freeze([[0,1,2], [0,2,1], [1,2,0], [1,0,2], [2,0,1], [2,1,0]]
		.map(Object.freeze))

const neighbour_directions_matrix =
	Object.freeze([
		[[-1, -1], [0, -1], [1, -1]],
		[[-1,  0], [0,  0], [1,  0]],
		[[-1,  1], [0,  1], [1,  1]],
	].map(row=>Object.freeze(row.map(Object.freeze))))

//move particle to a place
const copy = (src, dst) => {
	dst.type = src.type
	dst.tick = src.tick
	dst.initiative = src.initiative
	dst.abgr = src.abgr
	dst.velocity.x = src.velocity.x
	dst.velocity.y = src.velocity.y
	dst.subpixelPosition.x = src.subpixelPosition.x
	dst.subpixelPosition.y = src.subpixelPosition.y
	dst.mass = src.mass
	dst.temperature = src.temperature
	dst.scratch1 = src.scratch1
	dst.scratch2 = src.scratch2
}

const particleData = Object.freeze({ //particle data
	__proto__: null,
	0: {
		name: tr('air'),
		desc: tr('Your standard one bar of atmosphere. (You\'re soaking in it.)'),
		colour: 0,
		variation: 0,
		mass: 1.293, //kg/m³,
		create: ()=>{}, //*extra* create options

		process: ()=>ADVANCED_GAME_STATE.NO, //play a move, like, on a game-board
	},
	1: {
		name: tr('wall'),
		desc: tr('An intert, indestructable barrier.'),
		colour: flip(0x555555FF),
		variation: 0,
		mass: Infinity,
		create: ()=>{},
		copy: (src, dst)=>{
			dst.type = src.type
			dst.tick = src.tick
			dst.initiative = src.initiative
			dst.abgr = src.abgr
			dst.velocity.x = src.velocity.x
			dst.velocity.y = src.velocity.y
			dst.subpixelPosition.x = src.subpixelPosition.x
			dst.subpixelPosition.y = src.subpixelPosition.y
			dst.mass = src.mass
			dst.temperature = src.temperature
		},
		process: ()=>ADVANCED_GAME_STATE.NO,
	},
	2: {
		name: tr('sand'),
		desc: tr('A thin silica powder, such as might be found on a tropical beach. Gets into everything!'),
		colour: flip(0xFBDFB3FF),
		variation: 0x05220A00, //hsv
		mass: 1682,
		create: ()=>{},
		copy: (src, dst) => {
			dst.type = src.type
			dst.tick = src.tick
			dst.initiative = src.initiative
			dst.abgr = src.abgr
			dst.velocity.x = src.velocity.x
			dst.velocity.y = src.velocity.y
			dst.subpixelPosition.x = src.subpixelPosition.x
			dst.subpixelPosition.y = src.subpixelPosition.y
			dst.mass = src.mass
			dst.temperature = src.temperature
		},
		process: (workerID, part) => {
			if (part.tick < world.tick[0]) {
				part.tick = world.tick[0]
				part.initiative += 1
			}
			
			if (part.initiative <= 0) {
				return ADVANCED_GAME_STATE.NO
			}
			
			rng.seed(((part.x + part.y)*(part.x + part.y + 1)/2) + part.y + ((Number(world.tick[0]%BigInt(Number.MAX_SAFE_INTEGER/96|0)))*96))
			rng.float()
			rng.float()
			rng.float()
			let dest;
			//for (const dir of threes_permute[rng(0,6)]) {
			for (const dir of threes_permute[Math.floor(Math.random()*6)]) {
				const [nx, ny] = neighbour_directions_matrix[2][dir]
				dest = acquire(
					world, 
					part.x + nx,
					part.y + ny,
				)
				if (dest.ok) {
					if (dest.mass < part.mass) {
						part.initiative -= nx?1:1.4142135623730951
						copy(dest, tmp1)
						copy(part, dest)
						copy(tmp1, part)
						dest.release()
						return ADVANCED_GAME_STATE.YES
					} else {
						dest.release()
					}
				}
			}
			return ADVANCED_GAME_STATE.NO
		},
	},
})


const ADVANCED_GAME_STATE = { NO: 0, YES: 1 }

// Advance the state of a single particle.
// Locks particle, and any sub-particles eventually involved in the interaction.
export const processParticle = (world, workerID, x, y) => {
	const part = acquire(workerID, x,y)
	if (part.ok) {
		const retval = particleData[part.type].process(workerID, part)
		part.release()
		return retval
	} else
		return ADVANCED_GAME_STATE.NO;
}

// Create a particle out of thin air.
// Does not lock particle - this must be done beforehand, and undone afterhand.
// This is because drawing, we generally want to draw all the particles in *at
// the same time*. If we draw the top row, they could theoretically be simulated
// and fall down to the next row we draw, then we draw in those on top, they
// fall down, and at the end we're left with only one line of particles.
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
	part.create(world, parts, i, x, y)
	
	return ADVANCED_GAME_STATE.YES;
}