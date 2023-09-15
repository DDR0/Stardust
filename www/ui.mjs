/// Bind HTML to underlying state.
export const bindWorldToDisplay = (world, display, draw) => {
	const $ = display.querySelector.bind(display)
	const $$ = display.querySelectorAll.bind(display)
	const mainCanvas = $('canvas.main')
	
	let selectedTypeId = +$('.toolbox [name=type_id]:checked').value
	let selectedTool = $('.toolbox [name=tool]:checked').value
	let toolRadius = 10 //particles
	
	let updateCanvasRenderer = console.error.bind(0, 'unset')
	
	mainCanvas.addEventListener("contextlost", console.warn)
	mainCanvas.addEventListener("contextrestored", console.warn)
	
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
			console.log(`Canvas resized to ${canvas.width}×${canvas.height} – TODO: copy pixel data upon resize here.`)
			
			world.bounds.x[0] = canvas.width;
			world.bounds.y[0] = canvas.height;
			
			updateCanvasRenderer()
			
			draw.test(100, 50)
		}
	}).observe(mainCanvas)
	
	
	//The renderer takes particle data and puts in on the canvas.
	//Some jiggery-pokery to putImageData while allocating as few things as possible.
	//We do need to copy the world.particles.abgr because it's backed by a SharedArrayBuffer,
	//and ImageData requires arrays with *non-shared*, *non-resizable* buffers.
	//Note: createImageBitmap() goes the opposite way we want, we already have the data.
	{
		const context = mainCanvas.getContext('2d', {
			alpha: false, 
			desynchronized: true, //set to false if tearing is an issue, should just be speedier for us though 
			colorSpace: 'display-p3', 
			willReadFrequently: false,
		})
		let inputArray, outputArray, imageData
		let then = performance.now()
		
		updateCanvasRenderer = () => {
			const {width, height} = mainCanvas
			//Create a new array of right length, but with a `SharedArrayBuffer` backing it.
			inputArray = new Uint8ClampedArray(world.particles.abgr.buffer, 0, 4*width*height)
			//Create a new array with a non-shared, non-resizable `ArrayBuffer` backing it.
			outputArray = new Uint8ClampedArray(inputArray.length)
			//`imageData` sees updates to the `outputArray` data.
			imageData = new ImageData(outputArray, width, height)
		}
		updateCanvasRenderer()
		
		//console.debug(`frame delta: ${(now-then).toFixed(2)}µs`)
		//world.particles.abgr[(Math.random()*imageData.width*imageData.height)|0] = 0x77FF00FF
		
		const drawFrame = now => {
			outputArray.set(inputArray)
			context.putImageData(imageData, 0,0)
			requestAnimationFrame(drawFrame)
			then = now
		}
		drawFrame(then)
	}

	console.info('Started frame render.')
	
	
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