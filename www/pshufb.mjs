//Javascript/ECMAScript adaptation of the Intel pshufb instruction.
//Does not work in-place. No zeroing. CC BY-NC-SA 2023 DDR0.
export const pshufb = Object.freeze({
	__proto__: null,
	
	///JS number implementation, 32 bits.
	num: (num, mask) => 0
		| ((num >>> ((mask >>>  0 & 0xFF)*8) & 0xFF) <<  0)
		| ((num >>> ((mask >>>  8 & 0xFF)*8) & 0xFF) <<  8)
		| ((num >>> ((mask >>> 16 & 0xFF)*8) & 0xFF) << 16)
		| ((num >>> ((mask >>> 24 & 0xFF)*8) & 0xFF) << 24),
	
	///JS BigInt implementation, covers the powers from 64 to 2048 bits.
	big: (num, mask) => {
		let out = 0n, byte = 0n
		while (!((!mask) && (byte == 64 || byte == 128 || byte == 256 || byte == 512 || byte == 1024 || byte == 2048))) {
			out |= ((num >> ((mask & 255n)*8n) & 255n) << byte)
			byte += 8n
			mask >>= 8n
		}
		return out
	},
})