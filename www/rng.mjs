export const rng = Object.freeze((()=>{
	let seed = 1;
	const next = () => seed = seed * 16807 % 2147483647 //between 1 and 2^32 - 2
	const rng = (min, max) => rng.float() * (max-min) + min | 0
	rng.float = () => (next() - 1) / 2147483646
	rng.seed = newSeed => seed = (newSeed + 1) % 2147483647
	return rng
})())

for (let i = 0; i < 10; i++) {
	rng.seed(i)
	console.assert(rng(0, 2) >= 0 && rng(0, 2) < 2, `range out of range for seed ${i}`)
	console.assert(rng.float() >= 0 && rng.float() < 1, `float out of range for seed ${i}`)
}