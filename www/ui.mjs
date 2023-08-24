/// Bind HTML to underlying state.
export const bindWorldToDisplay = (world, display, draw) => {
	const $ = display.querySelector.bind(display)
	const $$ = display.querySelectorAll.bind(display)
	const mainCanvas = $('canvas.main')
	
	let selectedTypeId = +$('.toolbox [name=type_id]:checked').value
	let selectedTool = $('.toolbox [name=tool]:checked').value
	let toolRadius = 10 //particles
	
	
	// Canvas resizing.
	new ResizeObserver(([{target: canvas}]) => {
		const lockAttempts = 200;
		const timeToWait = 2000; //ms, total
		
		//Firefox doesn't support asyncWait as of 2022-06-12.
		Atomics.waitAsync ? acquireWorldLock() : updateCanvasSize()
		
		async function acquireWorldLock(iter=1) {
			//I think this suffers from lock contention, there's no guarantee it'll ever really be free. We should probably just copy it over from a cache every frame.
			if(0 === Atomics.compareExchange(world.lock, 0, 0, 1)) {
				updateCanvasSize() //Safely, lock obtained.
				Atomics.store(world.lock, 0, 0)
				Atomics.notify(world.lock, 0)
			}
			else if (iter > lockAttempts) {
				updateCanvasSize(); //Yolo, couldn't get lock.
				console.error(`Failed to acquire world lock.`)
			}
			else {
				await Atomics.waitAsync(world.lock, 0, 0, timeToWait/lockAttempts)
				acquireWorldLock(iter + 1)
				console.info(`Failed to acquire world lock ×${iter}.`)
			}
		}
		
		function updateCanvasSize() {
			//canvas.width = 3;
			//canvas.height = 4;
			console.log(`canvas resized to ${canvas.width}×${canvas.height} – TODO: copy pixel data here.`)
			
			world.bounds.x[0] = canvas.width;
			world.bounds.y[0] = canvas.height;
		}
	}).observe(mainCanvas)
	
	
	// Toolbox logic.
	for (let input of $$('.toolbox [name=type_id]')) {
		input.addEventListener('change', evt => {
			selectedTypeId = +evt.target.value
			updateCursor()
			return evt.stopPropagation()
		})
	}
	
	for (let input of $$('.toolbox [name=tool]')) {
		input.addEventListener('change', evt => {
			selectedTool = evt.target.value
			updateCursor()
			return evt.stopPropagation()
		})
	}
	
	function updateCursor() {
		display.style.cursor = "default" //TODO: Make the cursor reflect the selection, using the url(...) syntax with canvas' toDataURL function.
	}
	updateCursor()
	
	{
		const mouseHandler = evt => {
			if (!evt.buttons) { return };
			
			const clientRect = evt.target.getClientRects()[0]
			const x1 = Math.round(evt.x - clientRect.x) 
			const y1 = Math.round(evt.y - clientRect.y)
			const x2 = x1 - evt.movementX;
			const y2 = y1 - evt.movementY;
			
			switch (selectedTool) {
				case "picker":
					return console.error('unimplimented')
				case "pencil":
					//TODO: Use line here.
					return draw.dot(x1, y1, toolRadius, selectedTypeId)
				case "eraser":
					//TODO: Use line here.
					return draw.dot(x1, y1, toolRadius, 0)
				default:
					return console.error(`Unknown tool ${selectedTool}`)
			}
		}
		mainCanvas.addEventListener('mousedown', mouseHandler)
		mainCanvas.addEventListener('mousemove', mouseHandler)
	}
}