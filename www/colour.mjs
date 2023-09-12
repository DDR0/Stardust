//Convert colour from 32-bit RGBA to 32-bit ABGR.
//(A fine use for `pshufb`, if it was worth importing.)
export const colour = c =>
	(c & 0xFF) << 24 | (c & 0xFF << 8) << 8 | (c & 0xFF << 16) >>> 8 | c >>> 24

//export const colour = c =>
//	pshufb.num(c, 0x00010203)
