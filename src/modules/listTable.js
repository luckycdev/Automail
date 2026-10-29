//replaces AniList's list table with one that has configurable columns
//AniList's own table stays in the page (hidden), it still does the searching, filtering and sorting
//the visible rows are mirrored from it, and the data comes from AniList's store
let ListTable = (function(){
	let CONFIG_KEY = "listTableConfig";
	let CHUNK = 50;//rows rendered per section at a time, more are added while scrolling

	//column definitions
	//types: "A" = anime lists, "M" = manga lists
	//native: the AniList class name used for the cell, keeps AniList's own styling for those columns
	//api: needs data that is not in AniList's store and has to be fetched separately
	//wide: text column, gets more room and is truncated, click to expand
	let COLUMNS = {
		score:         {label: "Score", types: "AM", native: "score"},
		progress:      {label: "Progress", types: "A", native: "progress"},
		chapters:      {label: "Chapters", types: "M", native: "progress"},
		volumes:       {label: "Volumes", types: "M", native: "progress progress-volumes", headClass: "progress"},
		status:        {label: "Status", types: "AM", native: "status", hint: "custom lists only"},
		format:        {label: "Type", types: "AM", native: "format"},
		alScore:       {label: "AniList Score", short: "AniList\nScore", types: "AM", api: true},
		popularity:    {label: "Popularity", types: "AM"},
		startDate:     {label: "Start Date", short: "Start\nDate", types: "AM"},
		finishDate:    {label: "Finish Date", short: "Finish\nDate", types: "AM"},
		daysTaken:     {label: "Days Taken", short: "Days\nTaken", types: "AM"},
		lastUpdated:   {label: "Last Updated", short: "Last\nUpdated", types: "AM"},
		episodes:      {label: "Episodes", types: "A"},
		duration:      {label: "Duration", types: "A", api: true},
		totalTime:     {label: "Time Watched", short: "Time\nWatched", types: "A", api: true, hint: "incl. rewatches"},
		totalChapters: {label: "Total Chapters", short: "Total\nChapters", types: "M"},
		totalVolumes:  {label: "Total Volumes", short: "Total\nVolumes", types: "M"},
		repeat:        {label: "Rewatches", labelManga: "Rereads", types: "AM"},
		releaseStatus: {label: "Release Status", short: "Release\nStatus", types: "AM"},
		year:          {label: "Year", types: "AM"},
		season:        {label: "Season", types: "A", api: true},
		source:        {label: "Source", types: "AM", api: true},
		country:       {label: "Country", types: "AM"},
		studio:        {label: "Studio", types: "A", api: true, wide: true},
		notes:         {label: "Notes", types: "AM", wide: true},
		genres:        {label: "Genres", types: "AM", wide: true},
		tags:          {label: "Tags", types: "AM", wide: true}
	};
	let DEFAULT_ON = {
		ANIME: ["score","progress","status","format"],
		MANGA: ["score","chapters","volumes","status","format"]
	};
	let typeKey = type => type === "MANGA" ? "manga" : "anime";
	let columnsFor = type => Object.keys(COLUMNS).filter(id => COLUMNS[id].types.includes(type === "MANGA" ? "M" : "A"));

	//config
	function defaultTypeConfig(type){
		let enabled = {};
		columnsFor(type).forEach(id => enabled[id] = DEFAULT_ON[type].includes(id));
		return {on: true,order: columnsFor(type), enabled: enabled}//on: false shows AniList's own table for this list type
	}
	function defaultConfig(){
		return {
			anime: defaultTypeConfig("ANIME"),
			manga: defaultTypeConfig("MANGA"),
			dateFormat: "YYYY-MM-DD",
			dateSeparator: "-",
			headerLineBreaks: true,
			fillBlanks: false,
			style: defaultStyle()
		}
	}
	function defaultStyle(){
		return {
			lines: "none",//"none", "horizontal", "vertical" or "both"
			columnWidths: "even",//"even": spare room shared out like AniList's table, "fit": columns hug their content, the title gets the rest
			cellPadding: null,//px of space on each side of a column, null: AniList's own (20px, 15px in the compact layout)
			extraWidth: 0//px added to the width AniList allows for the list
		}
	}
	let clamp = (value,min,max,fallback) => Number.isFinite(+value) ? Math.min(max,Math.max(min,+value)) : fallback;
	function normaliseConfig(raw){
		let config = Object.assign(defaultConfig(), raw || {});
		config.fillBlanks = config.fillBlanks === true;
		let style = Object.assign(defaultStyle(), (raw && raw.style) || {});
		config.style = {
			lines: ["none","horizontal","vertical","both"].includes(style.lines) ? style.lines : "none",
			columnWidths: style.columnWidths === "fit" ? "fit" : "even",
			cellPadding: (style.cellPadding === null || style.cellPadding === undefined) ? null : clamp(style.cellPadding,0,40,null),
			extraWidth: clamp(style.extraWidth,0,2000,0)
		};
		["ANIME","MANGA"].forEach(type => {
			let key = typeKey(type);
			let defaults = defaultTypeConfig(type);
			let stored = config[key] && Array.isArray(config[key].order) ? config[key] : defaults;
			let valid = columnsFor(type);
			//keep the stored order, drop unknown columns, append new ones at the end
			let order = stored.order.filter(id => valid.includes(id));
			valid.forEach(id => {
				if(!order.includes(id)){
					order.push(id)
				}
			});
			let enabled = {};
			valid.forEach(id => {
				enabled[id] = hasOwn(stored.enabled || {}, id) ? !!stored.enabled[id] : defaults.enabled[id]
			});
			config[key] = {on: stored.on !== false,order: order, enabled: enabled}
		});
		return config
	}
	function loadConfig(){
		try{
			return normaliseConfig(JSON.parse(localStorage.getItem(CONFIG_KEY)))
		}
		catch(e){
			return defaultConfig()
		}
	}
	let config = loadConfig();
	let settingsListeners = new Set();
	//kind "order" or "style" only needs the css rewritten, other changes rebuild the rows
	//source is the settings panel that made the change, it doesn't need to be redrawn
	function saveConfig(kind,source){
		try{
			localStorage.setItem(CONFIG_KEY,JSON.stringify(config))
		}
		catch(e){
			console.warn("could not save list table settings",e)
		}
		configChanged(kind,source)
	}
	function configChanged(kind,source){
		let restyleOnly = kind === "order" || kind === "style";
		if(!restyleOnly){
			state.version++
		}
		settingsListeners.forEach(fn => fn(source));
		updateLayoutStyle();
		applyWidth();
		scheduleWidthSync();
		if(restyleOnly){
			state.sections.forEach(updateScrollMode)
		}
		else{
			refresh()
		}
	}
	//keep other tabs (e.g. the settings page open next to the list) in sync
	window.addEventListener("storage",function(e){
		if(e.key === CONFIG_KEY){
			config = loadConfig();
			configChanged()
		}
	});

	//column layout
	//every section is one css grid and the rows use subgrid, so the columns line up
	//column order and widths are in a generated stylesheet, so changing them doesn't touch the rows
	let layoutStyle = null;
	function updateLayoutStyle(){
		if(!layoutStyle || !layoutStyle.isConnected){
			layoutStyle = create("style","#listTableLayout",false,document.head)
		}
		let type = state.type || "ANIME";
		let cols = activeColumns(type);
		//columns are never narrower than their content, the section scrolls sideways instead
		//even: spare room is shared like AniList does it (3.5 parts for the title, 1 for the others)
		//fit: columns fit their content, the title and text columns get the rest
		let even = config.style.columnWidths !== "fit";
		//kind is "custom" (AniList shows status there), "completed" (split by format, type is hidden) or "normal"
		let template = kind => ["var(--listTable-cover-width, 60px)",even ? "minmax(220px, var(--listTable-title-share, 3.5fr))" : "minmax(220px, 2fr)"].concat(
			cols.map(id => {
				if(COLUMNS[id].wide){
					return even ? "minmax(90px, 1.2fr)" : "minmax(90px, 0.6fr)"
				}
				//columns AniList hides in this kind of section take no room
				if((id === "status" && kind !== "custom") || (id === "format" && kind === "completed")){
					return "0px"
				}
				//natural width is the widest cell in any section, see syncColumnWidths
				let natural = "var(--listTable-w-" + id + ", max-content)";
				if(!even){
					return natural
				}
				return "minmax(" + natural + ", 1fr)"
			})
		).join(" ");
		let css = "@media (min-width: 761px){\n"
			+ ".medialist .listTable-section{grid-template-columns: " + template("normal") + ";}\n"
			+ ".medialist .listTable-section.custom-list{grid-template-columns: " + template("custom") + ";}\n"
			+ ".medialist .listTable-section.completed-list{grid-template-columns: " + template("completed") + ";}\n";
		cols.forEach((id,index) => {
			css += ".medialist .listTable-section .listTable-cell-" + id + "{grid-column: " + (index + 3) + ";}\n"
		});
		css += "}\n";
		//narrow screens use AniList's flex layout, where "order" sets the order
		cols.forEach((id,index) => {
			css += ".medialist .listTable-section .listTable-cell-" + id + "{order: " + (index + 1) + ";}\n"
		});
		//table style
		let style = config.style;
		if(style.cellPadding !== null){
			css += ".medialist .listTable-section{--listTable-cell-pad: " + style.cellPadding + "px;}\n"
		}
		//lines are one device pixel wide, with 1px they can be 1 or 2 pixels depending on zoom
		css += ".medialist .listTable-section{--listTable-hairline: " + (1/(window.devicePixelRatio || 1)) + "px;}\n";
		if(style.lines === "horizontal" || style.lines === "both"){
			css += ".medialist .listTable-section > .list-head{border-bottom: var(--listTable-hairline, 1px) solid var(--listTable-line-colour);}\n"
				+ ".medialist .listTable-section > .list-entries > .entry + .entry{border-top: var(--listTable-hairline, 1px) solid var(--listTable-line-colour);}\n"
				//the hovered row is a solid colour, a darker line stays visible on it
				+ ".medialist .listTable-section > .list-entries > .entry + .entry:hover{border-top-color: rgba(0,0,0,.3);}\n"
		}
		if(style.lines === "vertical" || style.lines === "both"){
			css += "@media (min-width: 761px){.medialist .listTable-section > .listTable-vline{display: block;}}\n"
		}
		layoutStyle.textContent = css
	}
	function activeColumns(type){
		let c = config[typeKey(type)];
		return c.order.filter(id => c.enabled[id] && COLUMNS[id])
	}

	//formatting
	let FORMAT_NAMES = {
		TV: "TV", TV_SHORT: "TV Short", MOVIE: "Movie", SPECIAL: "Special", OVA: "OVA", ONA: "ONA",
		MUSIC: "Music", MANGA: "Manga", NOVEL: "Light Novel", ONE_SHOT: "One-Shot"
	};
	let STATUS_NAMES = {
		CURRENT: "Current", PLANNING: "Planning", COMPLETED: "Completed",
		DROPPED: "Dropped", PAUSED: "Paused", REPEATING: "Repeating"
	};
	let enumName = value => value ? value.toLowerCase().split("_").map(capitalize).join(" ") : null;
	function formatDate(year,month,day){
		if(!year && !month && !day){
			return null
		}
		let pad = n => n ? String(n).padStart(2,"0") : "??";
		let parts = {
			YYYY: year ? String(year) : "????",
			YY: year ? String(year).slice(-2) : "??",
			MM: pad(month),
			M: month ? String(month) : "?",
			DD: pad(day),
			D: day ? String(day) : "?"
		};
		return config.dateFormat.split("-").map(part => parts[part]).join(config.dateSeparator)
	}
	let fuzzyDate = date => date ? formatDate(date.year,date.month,date.day) : null;
	let dayNumber = (y,m,d) => Math.floor(Date.UTC(y,(m || 1) - 1,d || 1)/86400000);
	function formatDuration(minutes){
		if(minutes < 60){
			return Math.round(minutes) + "m"
		}
		let oneDecimal = n => (Math.round(n*10)/10).toString();
		if(minutes < 1440){
			return oneDecimal(minutes/60) + "h"
		}
		return oneDecimal(minutes/1440) + "d"
	}
	let SVG = {
		ellipsis: {viewBox: "0 0 512 512", cls: "fa-ellipsis-h fa-w-16 fa-lg", d: "M328 256c0 39.8-32.2 72-72 72s-72-32.2-72-72 32.2-72 72-72 72 32.2 72 72zm104-72c-39.8 0-72 32.2-72 72s32.2 72 72 72 72-32.2 72-72-32.2-72-72-72zm-352 0c-39.8 0-72 32.2-72 72s32.2 72 72 72 72-32.2 72-72-32.2-72-72-72z"},
		comment: {viewBox: "0 0 512 512", cls: "fa-comment fa-w-16", d: "M256 32C114.6 32 0 125.1 0 240c0 49.6 21.4 95 57 130.7C44.5 421.1 2.7 466 2.2 466.5c-2.2 2.3-2.8 5.7-1.5 8.7S4.8 480 8 480c66.3 0 116-31.8 140.6-51.4 32.7 12.3 69 19.4 107.4 19.4 141.4 0 256-93.1 256-208S397.4 32 256 32z"},
		redo: {viewBox: "0 0 512 512", cls: "fa-redo-alt fa-w-16", d: "M256.455 8c66.269.119 126.437 26.233 170.859 68.685l35.715-35.715C478.149 25.851 504 36.559 504 57.941V192c0 13.255-10.745 24-24 24H345.941c-21.382 0-32.09-25.851-16.971-40.971l41.75-41.75c-30.864-28.899-70.801-44.907-113.23-45.273-92.398-.798-170.283 73.977-169.484 169.442C88.764 348.009 162.184 424 256 424c41.127 0 79.997-14.678 110.629-41.556 4.743-4.161 11.906-3.908 16.368.553l39.662 39.662c4.872 4.872 4.631 12.815-.482 17.433C378.202 479.813 319.926 504 256 504 119.034 504 8.001 392.967 8 256.002 7.999 119.193 119.646 7.755 256.455 8z"},
		columns: {viewBox: "0 0 512 512", cls: "fa-columns fa-w-16", d: "M464 32H48C21.49 32 0 53.49 0 80v352c0 26.51 21.49 48 48 48h416c26.51 0 48-21.49 48-48V80c0-26.51-21.49-48-48-48zM224 416H64V160h160v256zm224 0H288V160h160v256z"},
		smile: {viewBox: "0 0 496 512", cls: "fa-smile fa-w-16 fa-lg", d: "M248 8C111 8 0 119 0 256s111 248 248 248 248-111 248-248S385 8 248 8zm0 448c-110.3 0-200-89.7-200-200S137.7 56 248 56s200 89.7 200 200-89.7 200-200 200zm-80-216c17.7 0 32-14.3 32-32s-14.3-32-32-32-32 14.3-32 32 14.3 32 32 32zm160 0c17.7 0 32-14.3 32-32s-14.3-32-32-32-32 14.3-32 32 14.3 32 32 32zm4 72.6c-20.8 25-51.5 39.4-84 39.4s-63.2-14.3-84-39.4c-8.5-10.2-23.7-11.5-33.8-3.1-10.2 8.5-11.5 23.6-3.1 33.8 30 36 74.1 56.6 120.9 56.6s90.9-20.6 120.9-56.6c8.5-10.2 7.1-25.3-3.1-33.8-10.1-8.4-25.3-7.1-33.8 3.1z"},
		meh: {viewBox: "0 0 496 512", cls: "fa-meh fa-w-16 fa-lg", d: "M248 8C111 8 0 119 0 256s111 248 248 248 248-111 248-248S385 8 248 8zm0 448c-110.3 0-200-89.7-200-200S137.7 56 248 56s200 89.7 200 200-89.7 200-200 200zm-80-216c17.7 0 32-14.3 32-32s-14.3-32-32-32-32 14.3-32 32 14.3 32 32 32zm160-64c-17.7 0-32 14.3-32 32s14.3 32 32 32 32-14.3 32-32-14.3-32-32-32zm8 144H160c-13.2 0-24 10.8-24 24s10.8 24 24 24h176c13.2 0 24-10.8 24-24s-10.8-24-24-24z"},
		frown: {viewBox: "0 0 496 512", cls: "fa-frown fa-w-16 fa-lg", d: "M248 8C111 8 0 119 0 256s111 248 248 248 248-111 248-248S385 8 248 8zm0 448c-110.3 0-200-89.7-200-200S137.7 56 248 56s200 89.7 200 200-89.7 200-200 200zm-80-216c17.7 0 32-14.3 32-32s-14.3-32-32-32-32 14.3-32 32 14.3 32 32 32zm160-64c-17.7 0-32 14.3-32 32s14.3 32 32 32 32-14.3 32-32-14.3-32-32-32zm-80 128c-40.2 0-78 17.7-103.8 48.6-8.5 10.2-7.1 25.3 3.1 33.8 10.2 8.4 25.3 7.1 33.8-3.1 16.6-19.9 41-31.4 66.9-31.4s50.3 11.4 66.9 31.4c8.1 9.7 23.1 11.9 33.8 3.1 10.2-8.5 11.5-23.6 3.1-33.8C326 321.7 288.2 304 248 304z"},
		star: {viewBox: "0 0 576 512", cls: "fa-star fa-w-18", d: "M259.3 17.8L194 150.2 47.9 171.5c-26.2 3.8-36.7 36.1-17.7 54.6l105.7 103-25 145.5c-4.5 26.3 23.2 46 46.4 33.7L288 439.6l130.7 68.7c23.2 12.2 50.9-7.4 46.4-33.7l-25-145.5 105.7-103c19-18.5 8.5-50.8-17.7-54.6L382 150.2 316.7 17.8c-11.7-23.6-45.6-23.9-57.4 0z"}
	};
	function icon(name){
		let def = SVG[name];
		let svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
		svg.setAttribute("aria-hidden","true");
		svg.setAttribute("focusable","false");
		svg.setAttribute("role","img");
		svg.setAttribute("viewBox",def.viewBox);
		svg.setAttribute("class","svg-inline--fa " + def.cls);
		let path = document.createElementNS("http://www.w3.org/2000/svg","path");
		path.setAttribute("fill","currentColor");
		path.setAttribute("d",def.d);
		svg.appendChild(path);
		return svg
	}

	//aniList internals
	let appVue = () => {
		let app = document.getElementById("app");
		return app && app.__vue__
	};
	let store = () => appVue().$store;
	let entity = (kind,id) => store().getters.entity(kind,id);

	//hover tooltips and the notes dialog, copies of AniList's own
	let tooltip = null;
	let tooltipTarget = null;
	function hideTooltip(){
		if(tooltip){
			tooltip.remove();
			tooltip = null;
			tooltipTarget = null;
			window.removeEventListener("scroll",positionTooltip,true)
		}
	}
	//same placement as AniList: right of the icon, flipped to the left side when there's no room
	function positionTooltip(){
		if(!tooltip || !tooltipTarget){
			return
		}
		let GAP = 15;
		let MAX = 500;
		tooltip.style.cssText = "visibility: hidden; display: block; position: fixed; top: 0px; left: 0px; right: auto; max-width: " + MAX + "px; width: max-content;";
		let width = Math.min(tooltip.scrollWidth,MAX);
		let rect = tooltipTarget.getBoundingClientRect();
		let spaceRight = window.innerWidth - rect.right - 2*GAP;
		let spaceLeft = rect.left - 2*GAP;
		let flipLeft = spaceRight < width && spaceLeft > spaceRight;
		let space = flipLeft ? spaceLeft : spaceRight;
		let maxWidth = space >= width ? MAX : Math.min(width,space);
		tooltip.style.cssText = "visibility: visible; display: block; position: fixed; top: " + (rect.top - 8) + "px; "
			+ (flipLeft
				? "right: " + (window.innerWidth - rect.left + GAP) + "px; left: auto; "
				: "left: " + (rect.right + GAP) + "px; right: auto; ")
			+ "max-width: " + maxWidth + "px; width: max-content;"
	}
	function addTooltip(target,textFn){
		target.addEventListener("mouseenter",function(){
			hideTooltip();
			let text = textFn();
			if(!text && text !== 0){
				return
			}
			tooltip = create("div","hover-icon-tooltip",false,document.body);
			tooltip.textContent = String(text);
			tooltipTarget = target;
			positionTooltip();
			window.addEventListener("scroll",positionTooltip,true)
		});
		target.addEventListener("mouseleave",hideTooltip)
	}
	//AniList's notes dialog (Element UI dialog), notes rendered as markdown like AniList does
	function openNotesDialog(notes){
		hideTooltip();
		let modal = create("div","v-modal",false,document.body,"z-index: 2000;");
		modal.tabIndex = 0;
		let wrapper = create("div","el-dialog__wrapper",false,document.body,"z-index: 2001;");
		let dialog = create("div",["el-dialog","notes-dialog"],false,wrapper,"margin-top: 15vh;");
		dialog.setAttribute("role","dialog");
		dialog.setAttribute("aria-modal","true");
		dialog.setAttribute("aria-label","Notes");
		let header = create("div","el-dialog__header",false,dialog);
		create("span","el-dialog__title","Notes",header);
		let closeButton = create("button","el-dialog__headerbtn",false,header);
		closeButton.type = "button";
		closeButton.setAttribute("aria-label","Close");
		create("i",["el-dialog__close","el-icon","el-icon-close"],false,closeButton);
		let body = create("div","el-dialog__body",false,dialog);
		let markdown = create("div","markdown",false,body);
		try{
			//the notes are written by the list's owner, so they're sanitised before being shown as HTML
			markdown.innerHTML = DOMPurify.sanitize(makeHtml(notes))
		}
		catch(e){
			markdown.style.whiteSpace = "pre-line";
			markdown.textContent = notes
		}
		let hadClass = document.body.classList.contains("el-popup-parent--hidden");
		document.body.classList.add("el-popup-parent--hidden");
		let close = function(){
			wrapper.remove();
			modal.remove();
			if(!hadClass){
				document.body.classList.remove("el-popup-parent--hidden")
			}
			document.removeEventListener("keydown",onKey)
		};
		let onKey = function(e){
			if(e.key === "Escape"){
				close()
			}
		};
		closeButton.addEventListener("click",close);
		wrapper.addEventListener("click",function(e){
			if(e.target === wrapper){//click outside the dialog
				close()
			}
		});
		document.addEventListener("keydown",onKey)
	}

	//cell rendering
	function textCell(text){
		return (text === null || text === undefined || text === "") ? "" : String(text)
	}
	function progressText(value,max,isMax){
		return (!isMax && max) ? value + "/" + max : String(value === null || value === undefined ? 0 : value)
	}
	function plusButton(ctx,field){
		let plus = create("span","plus-progress","+");
		plus.addEventListener("click",function(e){
			e.preventDefault();
			e.stopPropagation();
			if(plus.dataset.busy){
				return
			}
			plus.dataset.busy = "1";
			let payload = {mediaId: ctx.media.id};
			payload[field] = (ctx.entry[field] || 0) + 1;
			Promise.resolve(store().dispatch("medialistEditor/save",payload)).catch(err => console.error(err)).finally(() => delete plus.dataset.busy)
		});
		return plus
	}
	//fill a cell, return false if the column is unknown
	let RENDER = {
		score: function(cell,ctx){
			let score = ctx.entry.score;
			cell.setAttribute("score",score || 0);
			if(!score){
				return
			}
			if(ctx.scoreFormat === "POINT_3"){
				let face = {3: "smile", 2: "meh", 1: "frown"}[score];
				if(face){
					cell.appendChild(icon(face))
				}
			}
			else if(ctx.scoreFormat === "POINT_5"){
				cell.appendChild(document.createTextNode(score + " "));
				cell.appendChild(icon("star"))
			}
			else{
				cell.textContent = score
			}
		},
		progress: function(cell,ctx){
			let max = ctx.media.episodes || ctx.media.chapters;
			let isMax = ctx.media.episodes ? ctx.entry.progress >= ctx.media.episodes : (!!ctx.media.chapters && ctx.entry.progress >= ctx.media.chapters);
			cell.appendChild(document.createTextNode(progressText(ctx.entry.progress,max,isMax) + " "));
			if(!isMax){//like AniList, no "+" once it's finished
				cell.appendChild(plusButton(ctx,"progress"))
			}
		},
		volumes: function(cell,ctx){
			let max = ctx.media.volumes;
			let isMax = !!max && ctx.entry.progressVolumes >= max;
			cell.appendChild(document.createTextNode(progressText(ctx.entry.progressVolumes,max,isMax) + " "));
			if(!isMax){
				cell.appendChild(plusButton(ctx,"progressVolumes"))
			}
		},
		status: (cell,ctx) => cell.textContent = STATUS_NAMES[ctx.entry.status] || textCell(enumName(ctx.entry.status)),
		format: (cell,ctx) => cell.textContent = FORMAT_NAMES[ctx.media.format] || textCell(enumName(ctx.media.format)),
		alScore: (cell,ctx) => cell.textContent = ctx.extra ? textCell(ctx.extra.averageScore) : "",
		popularity: (cell,ctx) => cell.textContent = ctx.media.popularity ? ctx.media.popularity.toLocaleString() : "",
		startDate: (cell,ctx) => cell.textContent = textCell(fuzzyDate(ctx.entry.startedAt)),
		finishDate: (cell,ctx) => cell.textContent = textCell(fuzzyDate(ctx.entry.completedAt)),
		daysTaken: function(cell,ctx){
			let start = ctx.entry.startedAt;
			let end = ctx.entry.completedAt;
			let full = d => !!(d && d.year && d.month && d.day);
			if(!full(start)){
				return//a partial date (say only a year) can't give an accurate number of days
			}
			let startDay = dayNumber(start.year,start.month,start.day);
			if(full(end)){
				//start to finish of the first run, rewatches don't stretch it
				cell.textContent = Math.max(0,dayNumber(end.year,end.month,end.day) - startDay) + "d"
			}
			else if(!end || (!end.year && !end.month && !end.day)){
				let now = new Date();
				cell.textContent = Math.max(0,dayNumber(now.getFullYear(),now.getMonth() + 1,now.getDate()) - startDay) + "d+";
				cell.title = "Since the start date, no finish date"
			}
		},
		lastUpdated: function(cell,ctx){
			if(ctx.entry.updatedAt){
				let d = new Date(ctx.entry.updatedAt*1000);
				cell.textContent = formatDate(d.getFullYear(),d.getMonth() + 1,d.getDate());
				cell.title = d.toLocaleString()
			}
		},
		episodes: (cell,ctx) => cell.textContent = textCell(ctx.media.episodes),
		duration: (cell,ctx) => cell.textContent = (ctx.extra && ctx.extra.duration) ? ctx.extra.duration + "m" : "",
		totalTime: function(cell,ctx){
			let duration = ctx.extra && ctx.extra.duration;
			if(!duration){
				return
			}
			let entry = ctx.entry;
			let episodes = ctx.media.episodes || 0;
			let progress = entry.progress || 0;
			let repeat = entry.repeat || 0;
			let watched;
			if(entry.status === "REPEATING"){
				//the full first watch, every finished rewatch, plus how far into the current rewatch
				watched = episodes ? episodes*(1 + repeat) + progress : progress
			}
			else{
				//progress is the latest run, each finished rewatch adds a full run
				watched = progress + repeat*episodes
			}
			if(watched){
				cell.textContent = formatDuration(watched*duration);
				cell.title = watched + " episodes x " + duration + " min" + ((repeat || entry.status === "REPEATING") ? " (incl. rewatches)" : "")
			}
		},
		chapters: null,//set below, same as progress
		totalChapters: (cell,ctx) => cell.textContent = textCell(ctx.media.chapters),
		totalVolumes: (cell,ctx) => cell.textContent = textCell(ctx.media.volumes),
		repeat: (cell,ctx) => cell.textContent = ctx.entry.repeat ? ctx.entry.repeat : "",
		releaseStatus: (cell,ctx) => cell.textContent = textCell(enumName(ctx.media.status)),
		year: (cell,ctx) => cell.textContent = textCell(ctx.media.startDate && ctx.media.startDate.year),
		season: (cell,ctx) => cell.textContent = (ctx.extra && ctx.extra.season) ? enumName(ctx.extra.season) + (ctx.extra.seasonYear ? " " + ctx.extra.seasonYear : "") : "",
		source: (cell,ctx) => cell.textContent = ctx.extra ? textCell(enumName(ctx.extra.source)) : "",
		country: (cell,ctx) => cell.textContent = textCell(ctx.media.countryOfOrigin),
		studio: (cell,ctx) => cell.textContent = (ctx.extra && ctx.extra.studios) ? ctx.extra.studios.nodes.map(s => s.name).join(", ") : "",
		notes: (cell,ctx) => cell.textContent = textCell(ctx.entry.notes),
		genres: (cell,ctx) => cell.textContent = (ctx.media.genres || []).join(", "),
		tags: (cell,ctx) => cell.textContent = (ctx.media.tags || []).map(t => t.name).join(", ")
	};
	RENDER.chapters = RENDER.progress;

	//the "label" attribute AniList puts on its own cells
	let NATIVE_LABELS = {score: "Score", progress: "Progress", chapters: "Progress", volumes: "Volumes", status: "Status", format: "Format"};
	function headerLabel(id,type){
		let col = COLUMNS[id];
		if(id === "repeat" && type === "MANGA"){
			return "Rereads"
		}
		if(id === "progress" || id === "chapters" || id === "volumes" || id === "score" || id === "format" || id === "status"){
			return col.label
		}
		return (config.headerLineBreaks && col.short) ? col.short : col.label
	}
	function cellClasses(id){
		let col = COLUMNS[id];
		if(col.native){
			return col.native.split(" ").concat(["listTable-cell-" + id])
		}
		let classes = ["listTable-col","listTable-cell-" + id];
		if(col.wide){
			classes.push("listTable-wide")
		}
		return classes
	}

	function buildHead(type){
		let head = create("div",["list-head","row"]);
		create("div","cover",false,head);
		create("div","title","Title",head);
		activeColumns(type).forEach(id => {
			let col = COLUMNS[id];
			let classes = col.headClass ? [col.headClass,"listTable-cell-" + id] : cellClasses(id);
			create("div",classes,false,head).textContent = headerLabel(id,type)
		});
		return head
	}

	function buildRow(entryId,section){
		let entry = entity("listEntry",entryId);
		if(!entry){
			return null
		}
		let media = entity("media",entry.media);
		if(!media){
			return null
		}
		let ctx = {
			entry: entry,
			media: media,
			extra: state.extra.get(media.id),
			scoreFormat: state.scoreFormat,
			type: state.type
		};
		let row = create("div",["entry","row","listTable-row"]);
		row.dataset.entryId = entryId;
		row.addEventListener("mouseenter",function(){
			//only needed when the section scrolls sideways, see css
			let rect = row.getBoundingClientRect();
			row.style.setProperty("--listTable-cover-x",(rect.left - 160) + "px");
			row.style.setProperty("--listTable-cover-y",(rect.top - 60) + "px")
		});
		//cover + edit button
		let cover = create("div","cover",false,row);
		let edit = create("div","edit",false,cover);
		edit.appendChild(icon("ellipsis"));
		edit.addEventListener("click",function(e){
			e.preventDefault();
			e.stopPropagation();
			store().dispatch("medialistEditor/open",media.id)
		});
		let image = create("div","image",false,cover);
		if(media.coverImage){
			image.style.backgroundImage = "url(\"" + media.coverImage.large + "\")"
		}
		//title + rewatch/notes icons
		let title = create("div","title",false,row);
		let link = create("a",false,false,title);
		link.href = "/" + (media.type === "MANGA" ? "manga" : "anime") + "/" + media.id + "/" + safeURL((media.title && media.title.userPreferred) || "") + "/";
		link.textContent = media.title ? media.title.userPreferred : "";
		link.addEventListener("click",function(e){
			//navigate inside the SPA instead of reloading the page, like AniList's own links
			if(e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey){
				return
			}
			e.preventDefault();
			appVue()._router.push(link.getAttribute("href"))
		});
		if(entry.repeat){
			let repeatIcon = create("span",["hover-icon","listTable-hover-icon"],false,title);
			let target = create("span","hover-icon-target",false,repeatIcon);
			target.appendChild(icon("redo"));
			addTooltip(target,() => entry.repeat)//AniList shows just the count
		}
		if(entry.notes){
			let notesIcon = create("span",["hover-icon","clickable","listTable-hover-icon"],false,title);
			let target = create("span","hover-icon-target",false,notesIcon);
			target.appendChild(icon("comment"));
			addTooltip(target,() => entry.notes);
			notesIcon.addEventListener("click",function(e){
				e.preventDefault();
				e.stopPropagation();
				openNotesDialog(entry.notes)
			})
		}
		//configurable columns
		activeColumns(state.type).forEach(id => {
			let cell = create("div",cellClasses(id),false,row);
			cell.setAttribute("label",NATIVE_LABELS[id] || headerLabel(id,state.type).replace("\n"," "));
			if(RENDER[id]){
				RENDER[id](cell,ctx)
			}
			if(COLUMNS[id].wide && cell.textContent){
				cell.title = cell.textContent;
				cell.addEventListener("click",function(e){
					e.stopPropagation();
					cell.classList.toggle("listTable-expanded")
				})
			}
			if(config.fillBlanks && !cell.firstChild){
				cell.textContent = "-"
			}
		});
		create("span",["release-status",media.status || "UNKNOWN"],false,row);
		return row
	}

	//changes whenever something shown in the row changes
	function rowKey(entryId){
		let e = entity("listEntry",entryId);
		if(!e){
			return "missing"
		}
		return [e.updatedAt,e.progress,e.progressVolumes,e.score,e.status,e.repeat,e.notes].join("|")
	}

	//state
	let state = {
		timer: null,
		el: null,//the .medialist element
		vue: null,//the MediaList component
		lists: null,//the .lists element
		type: null,
		user: null,
		scoreFormat: null,
		sections: new Map(),//.list-wrap element -> section state
		listsObserver: null,
		vueWatchers: [],
		version: 0,//bumped when columns/settings change, forces rows to rebuild
		extra: new Map(),//media id -> data fetched from the API
		extraKey: null,
		extraLoading: false,
		button: null,
		panel: null,
		widthContainer: null//the page container whose max-width we changed
	};

	function isListPage(){
		return /^\/user\/[^/]+\/(anime|manga)list\/?/.test(location.pathname)
	}
	function typeOn(type){
		return config[typeKey(type || "ANIME")].on
	}
	function enabled(){
		return state.vue && typeOn(state.type) && state.vue.layout !== "cards"
	}

	function attachSection(wrap){
		let vue = wrap.__vue__;
		if(!vue || !Array.isArray(vue.listEntries)){
			return
		}
		let el = create("div",["list-section","listTable-section"]);
		let entries = create("div",["list-entries"],false,el);
		let sentinel = create("div","listTable-sentinel",false,el);
		let section = {
			wrap: wrap,
			vue: vue,
			el: el,
			entries: entries,
			sentinel: sentinel,
			rows: new Map(),
			limit: CHUNK,
			headVersion: -1,
			headEl: null,
			unwatch: null,
			observer: null,
			pending: false
		};
		wrap.appendChild(el);
		wrap.classList.add("listTable-active");
		pauseNativeRendering(section);
		section.unwatch = vue.$watch(
			function(){
				//reading the entries here lets Vue track them, so this re-runs on filter, sort and edits
				return vue.listEntries.map(id => id + ":" + rowKey(id)).join(",")
			},
			() => scheduleRender(section)
		);
		section.observer = new IntersectionObserver(function(records){
			if(records.some(r => r.isIntersecting) && section.limit < section.vue.listEntries.length){
				section.limit += CHUNK;
				scheduleRender(section)
			}
		},{rootMargin: "800px"});
		section.observer.observe(sentinel);
		state.sections.set(wrap,section);
		renderSection(section)
	}

	//the hidden native table keeps adding rows when scrolling, since it always looks scrolled to the end
	//its scroll handler stops when $refs.list is missing, so that ref is hidden while our table is shown
	function pauseNativeRendering(section){
		let refs = section.vue.$refs;
		if(!refs){
			return
		}
		let saved = refs.list;
		try{
			Object.defineProperty(refs,"list",{
				configurable: true,
				enumerable: true,
				get: () => undefined,
				set: value => {saved = value}
			});
			section.restoreRef = function(){
				delete refs.list;
				refs.list = saved
			}
		}
		catch(e){/*not fatal, AniList will just render its hidden rows*/}
	}

	function detachSection(section){
		if(section.restoreRef){
			section.restoreRef();
			section.restoreRef = null
		}
		if(section.unwatch){
			section.unwatch()
		}
		if(section.observer){
			section.observer.disconnect()
		}
		section.el.remove();
		section.wrap.classList.remove("listTable-active");
		state.sections.delete(section.wrap)
	}

	function scheduleRender(section){
		if(section.pending){
			return
		}
		section.pending = true;
		requestAnimationFrame(function(){
			section.pending = false;
			if(state.sections.get(section.wrap) === section){
				renderSection(section)
			}
		})
	}

	function renderSection(section){
		let native = section.wrap.querySelector(":scope > .list-section:not(.listTable-section)");
		//copy completed-list / custom-list classes so AniList's per-section CSS still applies
		let nativeClasses = native ? Array.from(native.classList).filter(c => c !== "list-section") : [];
		section.el.className = ["list-section","listTable-section"].concat(nativeClasses).join(" ");
		if(section.headVersion !== state.version){
			let head = buildHead(state.type);
			if(section.headEl){
				section.headEl.replaceWith(head)
			}
			else{
				section.el.insertBefore(head,section.entries)
			}
			section.headEl = head;
			section.headVersion = state.version;
			//one vertical line per column position, only shown when enabled
			section.el.querySelectorAll(":scope > .listTable-vline").forEach(line => line.remove());
			activeColumns(state.type).forEach((id,index) => {
				//these columns are hidden by AniList, a line there would be drawn on top of the next one
				if((id === "status" && !section.el.classList.contains("custom-list")) || (id === "format" && section.el.classList.contains("completed-list"))){
					return
				}
				let line = create("div","listTable-vline");
				line.style.gridColumn = String(index + 3);
				section.el.insertBefore(line,section.sentinel)
			});
			updateScrollMode(section)
		}
		let ids;
		try{
			ids = section.vue.listEntries
		}
		catch(e){
			return
		}
		let visible = ids.slice(0,section.limit);
		let rows = new Map();
		let nodes = [];
		visible.forEach(id => {
			let key = rowKey(id) + "|" + state.version + "|" + (state.extra.has(entity("listEntry",id) && entity("listEntry",id).media) ? 1 : 0);
			let cached = section.rows.get(id);
			if(!cached || cached.key !== key){
				let el = buildRow(id,section);
				cached = el ? {el: el, key: key} : null
			}
			if(cached){
				rows.set(id,cached);
				nodes.push(cached.el)
			}
		});
		hideTooltip();
		section.entries.replaceChildren(...nodes);
		section.rows = rows;
		updateScrollMode(section);
		scheduleWidthSync();
		let more = visible.length < ids.length;
		section.sentinel.style.display = more ? "" : "none";
		if(more){
			//re-observing makes the observer report again, in case the end of the rows is still on screen after this render
			section.observer.unobserve(section.sentinel);
			section.observer.observe(section.sentinel)
		}
	}

	//scroll sideways when the columns don't fit
	//only then, scrolling clips the large cover AniList shows on hover
	//every section is its own grid, so the columns of different sections wouldn't line up
	//measure the natural widths in all sections and use the widest
	let widthVars = {};
	let widthVarsOwner = null;
	let contentWidths = {};
	let widthSyncQueued = false;
	let nativePadding = null;
	let tight = false;
	let TIGHT_PADDING = 8;
	function scheduleWidthSync(){
		if(!widthSyncQueued){
			widthSyncQueued = true;
			requestAnimationFrame(function(){
				widthSyncQueued = false;
				syncColumnWidths();
				updateFit()
			})
		}
	}
	function syncColumnWidths(){
		if(!state.lists || !state.sections.size){
			return
		}
		let all = activeColumns(state.type);
		let cols = all.filter(id => !COLUMNS[id].wide);
		let widest = {};
		if(window.innerWidth > 760){
			state.sections.forEach(section => {
				let el = section.el;
				if(!el.isConnected){
					return
				}
				let previous = el.style.gridTemplateColumns;
				el.style.gridTemplateColumns = "var(--listTable-cover-width, 60px) max-content" + all.map(() => " max-content").join("");
				let tracks = getComputedStyle(el).gridTemplateColumns.split(" ");
				el.style.gridTemplateColumns = previous;
				//padding is kept out of the width, so spacing changes don't need new measuring
				let headCell = el.querySelector(":scope > .list-head > div:not(.cover):not(.title)");
				let pad = headCell ? parseFloat(getComputedStyle(headCell).paddingLeft) + parseFloat(getComputedStyle(headCell).paddingRight) : 0;
				all.forEach((id,index) => {
					let width = parseFloat(tracks[index + 2]) - pad;
					if(width > (widest[id] || 0)){
						widest[id] = width
					}
				})
			})
		}
		if(widthVarsOwner !== state.lists){
			widthVars = {};//new list element
			contentWidths = {};
			widthVarsOwner = state.lists
		}
		let style = state.lists.style;
		Object.keys(widthVars).forEach(id => {
			if(!cols.includes(id) || !widest[id]){
				style.removeProperty("--listTable-w-" + id);
				delete widthVars[id]
			}
		});
		let pad = currentPadding();
		cols.forEach(id => {
			if(widest[id]){
				contentWidths[id] = widest[id];
				if(pad !== null && widthVars[id] !== widest[id] + 2*pad){
					widthVars[id] = widest[id] + 2*pad;
					style.setProperty("--listTable-w-" + id,widthVars[id] + "px")
				}
			}
		})
	}
	//padding on each side of a column, null if it can't be read yet
	function currentPadding(){
		if(tight){
			return tightPadding()
		}
		if(config.style.cellPadding !== null){
			return config.style.cellPadding
		}
		let cell = state.lists && state.lists.querySelector(".listTable-section > .list-head > div:not(.cover):not(.title)");
		return cell ? parseFloat(getComputedStyle(cell).paddingLeft) : null
	}
	//spacing only changes the padding part of the widths
	function applyPaddingToWidths(){
		let pad = tight ? tightPadding() : (config.style.cellPadding !== null ? config.style.cellPadding : nativePadding);
		if(pad === null || !state.lists || widthVarsOwner !== state.lists){
			return
		}
		Object.keys(contentWidths).forEach(id => {
			if(widthVars[id] !== undefined){
				widthVars[id] = contentWidths[id] + 2*pad;
				state.lists.style.setProperty("--listTable-w-" + id,widthVars[id] + "px")
			}
		})
	}
	function clearColumnWidths(){
		if(state.lists){
			Object.keys(widthVars).forEach(id => state.lists.style.removeProperty("--listTable-w-" + id))
		}
		widthVars = {};
		contentWidths = {}
	}

	function tightPadding(){
		return config.style.cellPadding !== null ? Math.min(config.style.cellPadding,TIGHT_PADDING) : TIGHT_PADDING
	}
	//when the columns don't fit, use less space around them before resorting to scrolling
	function updateFit(){
		if(!state.lists){
			return
		}
		tight = false;
		state.lists.classList.remove("listTable-tight");
		if(window.innerWidth > 760){
			nativePadding = currentPadding();
			applyPaddingToWidths();
			let sections = Array.from(state.sections.values());
			sections.forEach(section => section.el.classList.remove("listTable-scroll"));
			if(
				(config.style.cellPadding === null || config.style.cellPadding > TIGHT_PADDING)
				&& sections.some(section => section.el.scrollWidth > section.el.clientWidth + 1)
			){
				tight = true;
				state.lists.classList.add("listTable-tight");
				applyPaddingToWidths()
			}
		}
		state.sections.forEach(updateScrollMode)
	}
	function updateScrollMode(section){
		section.el.classList.remove("listTable-scroll");
		let overflowing = section.el.scrollWidth > section.el.clientWidth + 1;
		section.el.classList.toggle("listTable-scroll",overflowing && window.innerWidth > 760)
	}

	//extra table width: let the page container grow past AniList's max-width
	function applyWidth(){
		let container = state.el && state.el.parentElement;
		if(!container){
			return
		}
		container.style.maxWidth = "";
		if(state.widthContainer && state.widthContainer !== container){
			state.widthContainer.style.maxWidth = ""
		}
		state.widthContainer = container;
		let extra = typeOn(state.type) ? config.style.extraWidth : 0;
		let native = getComputedStyle(container).maxWidth;
		if(extra > 0 && native && native !== "none"){
			container.style.maxWidth = "calc(" + native + " + " + extra + "px)"
		}
	}

	function syncSections(){
		if(!state.lists){
			return
		}
		let wraps = Array.from(state.lists.querySelectorAll(":scope > .list-wrap"));
		state.sections.forEach(section => {
			if(!enabled() || !wraps.includes(section.wrap) || section.wrap.__vue__ !== section.vue){
				detachSection(section)
			}
		});
		if(!enabled()){
			return
		}
		wraps.forEach(wrap => {
			if(!state.sections.has(wrap)){
				attachSection(wrap)
			}
		})
	}

	//extra data from the API
	function neededApiData(){
		return activeColumns(state.type).some(id => COLUMNS[id].api)
	}
	function loadExtra(){
		if(!state.user || !typeOn(state.type) || !neededApiData()){
			return
		}
		let key = state.user + ":" + state.type;
		if(state.extraKey === key && (state.extraLoading || state.extra.size)){
			return
		}
		state.extraKey = key;
		state.extraLoading = true;
		state.extra = new Map();
		let query = `query($userName: String, $type: MediaType){
	MediaListCollection(userName: $userName, type: $type){
		lists{
			entries{
				media{
					id
					averageScore
					duration
					source
					season
					seasonYear
					studios(isMain: true){nodes{name}}
				}
			}
		}
	}
}`;
		anilistAPI(query,{
			variables: {userName: state.user, type: state.type},
			cacheKey: "listTableExtra" + key,
			duration: 30*60*1000,
			auth: !!useScripts.accessToken
		}).then(function(res){
			if(state.extraKey !== key){
				return
			}
			state.extraLoading = false;
			if(!res || !res.data || !res.data.MediaListCollection){
				console.warn("could not load extra list data",res && res.errors);
				return
			}
			res.data.MediaListCollection.lists.forEach(list => list.entries.forEach(entry => state.extra.set(entry.media.id,entry.media)));
			state.sections.forEach(scheduleRender)
		}).catch(function(err){
			state.extraLoading = false;
			console.error(err)
		})
	}

	//columns button + panel on the list page
	function ensureButton(){
		if(!state.lists){
			return
		}
		let layoutSwitch = state.lists.querySelector(":scope > .actions .layout-switch");
		if(!layoutSwitch){
			return
		}
		if(state.button && state.button.parentNode === layoutSwitch){
			return
		}
		state.button = create("span","listTable-columns-button",false,layoutSwitch);
		state.button.appendChild(icon("columns"));
		state.button.title = "Customise list columns";
		state.button.addEventListener("click",function(e){
			e.stopPropagation();
			togglePanel()
		})
	}
	function closePanel(){
		if(state.panel){
			state.panel.remove();
			state.panel = null;
			document.removeEventListener("mousedown",outsideClick,true)
		}
	}
	function outsideClick(e){
		if(state.panel && !state.panel.contains(e.target) && !(state.button && state.button.contains(e.target))){
			closePanel()
		}
	}
	function togglePanel(){
		if(state.panel){
			closePanel();
			return
		}
		state.panel = create("div",["listTable-panel"],false,document.body);
		buildSettings(state.panel,{type: state.type,compact: true});
		let rect = state.button.getBoundingClientRect();
		state.panel.style.top = (rect.bottom + window.scrollY + 8) + "px";
		state.panel.style.left = Math.max(8,rect.right + window.scrollX - state.panel.offsetWidth) + "px";
		document.addEventListener("mousedown",outsideClick,true)
	}

	//settings UI, used on the list page and on the settings page
	function buildSettings(container,options){
		options = options || {};
		let type = options.type === "MANGA" ? "MANGA" : "ANIME";
		let root = create("div","listTable-settings",false,container);
		let render = function(){
			removeChildren(root);
			let top = create("div","listTable-settings-top",false,root);
			create("span","listTable-settings-title","List columns",top);
			let tabs = create("div","listTable-tabs",false,top);
			["ANIME","MANGA"].forEach(t => {
				let tab = create("span",["listTable-tab"],t === "ANIME" ? "Anime" : "Manga",tabs);
				if(t === type){
					tab.classList.add("active")
				}
				tab.addEventListener("click",function(){
					type = t;
					render()
				})
			});
			let typeName = type === "MANGA" ? "manga" : "anime";
			let enableRow = create("label","listTable-enable",false,root);
			let enableBox = create("input",false,false,enableRow);
			enableBox.type = "checkbox";
			enableBox.checked = config[typeKey(type)].on;
			enableBox.addEventListener("change",function(){
				config[typeKey(type)].on = enableBox.checked;
				saveConfig(undefined,root)
			});
			create("span",false," Use the customisable table for the " + typeName + " list",enableRow);
			create("p","listTable-settings-help","When off, AniList's own table is shown for the " + typeName + " list. Your settings are kept.",root);
			create("p","listTable-settings-help","Drag to reorder. Changes apply immediately.",root);
		let list = create("ul","listTable-column-list",false,root);
		list.classList.toggle("listTable-off",!config[typeKey(type)].on);
			let typeConfig = config[typeKey(type)];
			let applyOrder = function(){
				let order = Array.from(list.children).map(li => li.dataset.column);
				if(order.join() !== typeConfig.order.join()){
					typeConfig.order = order;
					saveConfig("order",root)
				}
			};
			typeConfig.order.forEach(id => {
				let col = COLUMNS[id];
				let item = create("li","listTable-column",false,list);
				item.dataset.column = id;
				if(typeConfig.enabled[id]){
					item.classList.add("listTable-on")
				}
				let handle = create("span","listTable-handle","⠿",item);
				handle.title = "Drag to reorder";
				//pointer based dragging: works the same in every browser, and the table follows along live
				handle.addEventListener("pointerdown",function(e){
					if(e.button !== 0){
						return
					}
					e.preventDefault();
					handle.setPointerCapture(e.pointerId);
					item.classList.add("listTable-dragging");
					let scroller = container.scrollHeight > container.clientHeight ? container : null;
					let move = function(ev){
						let before = null;
						for(let li of list.children){
							if(li === item){
								continue
							}
							let rect = li.getBoundingClientRect();
							if(ev.clientY < rect.top + rect.height/2){
								before = li;
								break
							}
						}
						if(item.nextElementSibling !== before){
							//the neighbours are moved, moving the dragged item would make the browser drop the pointer capture
							let down = before === null || (item.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_FOLLOWING);
							while(item.nextElementSibling !== before){
								if(down){
									list.insertBefore(item.nextElementSibling,item)
								}
								else{
									let previous = item.previousElementSibling;
									if(!previous){
										break
									}
									list.insertBefore(previous,item.nextElementSibling)
								}
							}
							applyOrder()
						}
						if(scroller){
							let box = scroller.getBoundingClientRect();
							if(ev.clientY < box.top + 30){
								scroller.scrollTop -= 10
							}
							else if(ev.clientY > box.bottom - 30){
								scroller.scrollTop += 10
							}
						}
					};
					let stop = function(){
						item.classList.remove("listTable-dragging");
						handle.removeEventListener("pointermove",move);
						handle.removeEventListener("pointerup",stop);
						handle.removeEventListener("pointercancel",stop);
						handle.removeEventListener("lostpointercapture",stop);
						applyOrder()
					};
					handle.addEventListener("pointermove",move);
					handle.addEventListener("pointerup",stop);
					handle.addEventListener("pointercancel",stop);
					handle.addEventListener("lostpointercapture",stop)
				});
				let label = create("label",false,false,item);
				let checkbox = create("input",false,false,label);
				checkbox.type = "checkbox";
				checkbox.checked = !!typeConfig.enabled[id];
				checkbox.addEventListener("change",function(){
					typeConfig.enabled[id] = checkbox.checked;
					item.classList.toggle("listTable-on",checkbox.checked);
					saveConfig(undefined,root)
				});
				create("span",false,(id === "repeat" && type === "MANGA") ? col.labelManga : col.label,label);
				let hints = [];
				if(col.hint){
					hints.push(col.hint)
				}
				if(col.api){
					hints.push("loads extra data")
				}
				if(hints.length){
					create("span","listTable-hint",hints.join(", "),label)
				}
			});
			//table style, shared by anime and manga lists
			let styleBox = create("div","listTable-settings-style",false,root);
			create("p","listTable-settings-subtitle","Table style",styleBox);
			let linesRow = create("p",false,false,styleBox);
			create("span",false,"Grid lines ",linesRow);
			let linesSelect = create("select",["hohNativeInput","listTable-select"],false,linesRow);
			[["none","None"],["horizontal","Horizontal"],["vertical","Vertical"],["both","Both"]].forEach(option => {
				create("option",false,option[1],linesSelect).value = option[0]
			});
			linesSelect.value = config.style.lines;
			linesSelect.addEventListener("change",function(){
				config.style.lines = linesSelect.value;
				saveConfig("style",root)
			});
			let widthsRow = create("p",false,false,styleBox);
			create("span",false,"Column widths ",widthsRow);
			let widthsSelect = create("select",["hohNativeInput","listTable-select"],false,widthsRow);
			[["even","Even (like AniList)"],["fit","Fit content"]].forEach(option => {
				create("option",false,option[1],widthsSelect).value = option[0]
			});
			widthsSelect.value = config.style.columnWidths;
			widthsSelect.addEventListener("change",function(){
				config.style.columnWidths = widthsSelect.value;
				saveConfig("style",root)
			});
			//sliders fire a lot of events, so only the css is updated while dragging, the rest waits until it stops
			let previewQueued = false;
			let commitTimer = null;
			let preview = function(){
				if(!previewQueued){
					previewQueued = true;
					requestAnimationFrame(function(){
						previewQueued = false;
						updateLayoutStyle();
						applyPaddingToWidths();
						applyWidth()
					})
				}
			};
			//defaultValue: where the slider rests while the setting is null, canReset: show a button to set it back to null
			let slider = function(text,key,min,max,step,format,defaultValue,canReset){
				let row = create("p","listTable-slider-row",false,styleBox);
				create("span","listTable-slider-label",text,row);
				let input = create("input","listTable-slider",false,row);
				input.type = "range";
				input.min = min;
				input.max = max;
				input.step = step;
				input.value = config.style[key] === null ? defaultValue : config.style[key];
				let value = create("span","listTable-slider-value",format(config.style[key]),row);
				let reset = null;
				let showReset = () => {
					if(reset){
						reset.style.visibility = config.style[key] === null ? "hidden" : "visible"
					}
				};
				if(canReset){
					reset = create("button",["hohButton","button","listTable-slider-reset"],"Reset",row);
					reset.type = "button";
					reset.title = "Back to AniList's own spacing";
					reset.addEventListener("click",function(){
						clearTimeout(commitTimer);
						config.style[key] = null;
						input.value = defaultValue;
						value.textContent = format(null);
						showReset();
						saveConfig("style",root)
					});
					showReset()
				}
				input.addEventListener("input",function(){
					config.style[key] = +input.value;
					value.textContent = format(+input.value);
					showReset();
					preview();
					clearTimeout(commitTimer);
					commitTimer = setTimeout(function(){
						saveConfig("style",root)
					},250)
				})
			};
			slider("Column spacing","cellPadding",0,30,1,v => v === null ? "AniList" : v + "px",20,true);
			slider("Extra table width","extraWidth",0,1200,50,v => v ? "+" + v + "px" : "off",0);
			create("p","listTable-settings-help","With even widths, spacing mostly shows once columns get tight. Extra width only shows when your window is wider than the list.",styleBox);
			//other options
			let other = create("div","listTable-settings-other",false,root);
			let dateRow = create("p",false,false,other);
			create("span",false,"Date format ",dateRow);
			let dateSelect = create("select",["hohNativeInput","listTable-select"],false,dateRow);
			["YYYY-MM-DD","YY-MM-DD","MM-DD-YYYY","MM-DD-YY","M-D-YYYY","M-D-YY","DD-MM-YYYY","DD-MM-YY","D-M-YYYY","D-M-YY"].forEach(format => {
				create("option",false,format,dateSelect).value = format
			});
			dateSelect.value = config.dateFormat;
			dateSelect.addEventListener("change",function(){
				config.dateFormat = dateSelect.value;
				saveConfig(undefined,root)
			});
			let sepSelect = create("select",["hohNativeInput","listTable-select"],false,dateRow);
			[["-","dash -"],["/","slash /"],[".","dot ."],[" ","space"]].forEach(sep => {
				create("option",false,sep[1],sepSelect).value = sep[0]
			});
			sepSelect.value = config.dateSeparator;
			sepSelect.addEventListener("change",function(){
				config.dateSeparator = sepSelect.value;
				saveConfig(undefined,root)
			});
			let breakRow = create("p",false,false,other);
			let breakLabel = create("label",false,false,breakRow);
			let breakBox = create("input",false,false,breakLabel);
			breakBox.type = "checkbox";
			breakBox.checked = config.headerLineBreaks;
			breakBox.addEventListener("change",function(){
				config.headerLineBreaks = breakBox.checked;
				saveConfig(undefined,root)
			});
			create("span",false," Split long column headers over two lines",breakLabel);
			let fillRow = create("p",false,false,other);
			let fillLabel = create("label",false,false,fillRow);
			let fillBox = create("input",false,false,fillLabel);
			fillBox.type = "checkbox";
			fillBox.checked = config.fillBlanks;
			fillBox.addEventListener("change",function(){
				config.fillBlanks = fillBox.checked;
				saveConfig(undefined,root)
			});
			create("span",false," Show a hyphen (-) in empty cells",fillLabel);
			//resets all settings, needs a second click to confirm
			let resetLabel = "Reset all list table settings";
			let reset = create("button",["hohButton","button","listTable-reset"],resetLabel,other);
			let resetTimer = null;
			reset.addEventListener("click",function(){
				if(!reset.classList.contains("listTable-confirm")){
					reset.classList.add("listTable-confirm");
					reset.textContent = "Click again to reset everything";
					resetTimer = setTimeout(function(){
						reset.classList.remove("listTable-confirm");
						reset.textContent = resetLabel
					},4000);
					return
				}
				clearTimeout(resetTimer);
				config = defaultConfig();
				saveConfig()//redraws every open settings panel, including this one
			})
		};
		render();
		//keep this panel in sync if settings change somewhere else
		let listener = function(source){
			//don't redraw while a slider or dropdown here is being used
			if(source !== root && root.contains(document.activeElement) && (document.activeElement.type === "range" || document.activeElement.tagName === "SELECT")){
				return
			}
			if(!root.isConnected){
				settingsListeners.delete(listener);
				return
			}
			//the panel that made the change already shows it, redrawing it would interrupt dragging and clicking
			if(source !== root){
				render()
			}
		};
		settingsListeners.add(listener);
		return root
	}

	//lifecycle
	function teardown(){
		state.sections.forEach(detachSection);
		state.vueWatchers.forEach(unwatch => unwatch());
		state.vueWatchers = [];
		if(state.listsObserver){
			state.listsObserver.disconnect();
			state.listsObserver = null
		}
		if(state.button){
			state.button.remove();
			state.button = null
		}
		closePanel();
		hideTooltip();
		clearColumnWidths();
		if(state.lists){
			state.lists.classList.remove("listTable-tight")
		}
		tight = false;
		if(state.widthContainer){
			state.widthContainer.style.maxWidth = "";
			state.widthContainer = null
		}
		state.el = null;
		state.vue = null;
		state.lists = null
	}

	function tick(){
		if(!isListPage() || !useScripts.listTable){
			teardown();
			clearInterval(state.timer);
			state.timer = null;
			return
		}
		let el = document.querySelector(".medialist");
		let vue = el && el.__vue__;
		if(!vue || !vue.user){
			if(state.el){
				teardown()
			}
			return
		}
		let type = vue.type;
		if(el !== state.el || vue !== state.vue || type !== state.type){
			teardown();
			state.el = el;
			state.vue = vue;
			state.type = type;
			state.version++;
			updateLayoutStyle();
			state.vueWatchers.push(vue.$watch("layout",() => syncSections()));
			state.vueWatchers.push(vue.$watch(() => vue.options && vue.options.scoreFormat,function(format){
				state.scoreFormat = format;
				state.version++;
				state.sections.forEach(scheduleRender)
			}))
		}
		state.user = vue.user.name;
		state.scoreFormat = (vue.options && vue.options.scoreFormat) || state.scoreFormat;
		let lists = el.querySelector(":scope > .lists");
		if(lists !== state.lists){
			if(state.listsObserver){
				state.listsObserver.disconnect()
			}
			state.lists = lists;
			if(lists){
				state.listsObserver = new MutationObserver(syncSections);
				state.listsObserver.observe(lists,{childList: true})
			}
		}
		if(state.widthContainer !== el.parentElement){
			applyWidth()
		}
		ensureButton();
		loadExtra();
		syncSections()
	}

	function start(){
		if(!state.timer){
			state.timer = setInterval(tick,300)
		}
		tick()
	}

	function refresh(){
		if(!state.el){
			return
		}
		loadExtra();
		syncSections();//attaches or detaches the table when it was switched on or off
		state.sections.forEach(section => {
			updateScrollMode(section);
			scheduleRender(section)
		})
	}

	//the widths depend on the font, so measure again when it has loaded
	if(document.fonts){
		document.fonts.addEventListener("loadingdone",scheduleWidthSync);
		if(document.fonts.ready){
			document.fonts.ready.then(scheduleWidthSync)
		}
	}
	window.addEventListener("resize",function(){
		applyWidth();//AniList's max-width depends on the window size
		updateLayoutStyle();//zoom changes the device pixel ratio
		scheduleWidthSync()
	});

	return {
		start: start,
		refresh: refresh,
		buildSettings: buildSettings,
		COLUMNS: COLUMNS
	}
})();

exportModule({
	id: "listTable",
	description: "$listTable_description",
	extendedDescription: "$listTable_extendedDescription",
	isDefault: true,
	importance: 1,
	categories: ["Lists","Newly Added"],
	visible: true,
	urlMatch: function(url){
		return /^https:\/\/anilist\.co\/user\/[^/]+\/(anime|manga)list/.test(url)
	},
	code: function(){
		ListTable.start()
	},
	css: `
.medialist .list-wrap.listTable-active > .list-section:not(.listTable-section){
	display: none !important;
}
.listTable-section{
	contain: inline-size;/*long text must not stretch the page*/
	--listTable-line-colour: rgba(var(--color-text-lighter), .18);
}
.listTable-section > .listTable-vline{
	display: none;
}
/*AniList has "transition: all" here, which would animate changes to lines and spacing*/
.medialist .listTable-section > .list-head,
.medialist .listTable-section > .list-entries,
.medialist .listTable-section > .list-entries > .entry,
.medialist .listTable-section > .list-head > div,
.medialist .listTable-section > .list-entries > .entry > div:not(.cover){
	transition-property: background-color, color, box-shadow, opacity, transform;
}
@media (min-width: 761px){
	/*the page grid must not grow to fit the table, so the table scrolls instead*/
	.medialist .lists,
	.medialist .lists > .list-wrap{
		min-width: 0;
		max-width: 100%;
	}
	/*the head and the rows use the columns of the section grid (sizes are set in updateLayoutStyle)*/
	.medialist .listTable-section{
		display: grid;
	}
	.medialist .listTable-section > .list-head,
	.medialist .listTable-section > .list-entries,
	.medialist .listTable-section > .list-entries > .entry{
		display: grid;
		grid-template-columns: subgrid;
		grid-column: 1 / -1;
		align-items: center;
	}
	/*explicit rows, so the vertical lines can't push these around*/
	.medialist .listTable-section > .list-head{
		grid-row: 1;
	}
	.medialist .listTable-section > .list-entries{
		grid-row: 2;
	}
	.medialist .listTable-section > .listTable-sentinel{
		grid-column: 1 / -1;
		grid-row: 3;
	}
	.medialist .listTable-section > .list-head > div:not(.cover),
	.medialist .listTable-section > .list-entries > .entry > div:not(.cover){
		padding-left: var(--listTable-cell-pad, var(--listTable-native-pad));
		padding-right: var(--listTable-cell-pad, var(--listTable-native-pad));
		min-width: 0;
	}
	.medialist .listTable-section > .listTable-vline{
		mix-blend-mode: difference;/*visible on the hovered row too*/
		grid-row: 1 / 3;/*the head and the rows*/
		pointer-events: none;
		position: relative;
		z-index: 1;
	}
	.medialist .listTable-section > .listTable-vline::before{
		/*pseudo element, so the line takes up no room*/
		content: "";
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		border-left: var(--listTable-hairline, 1px) solid rgba(128,128,128,.22);
	}
	.medialist .listTable-section .cover{
		grid-column: 1;
		padding: 0;
	}
	.medialist .listTable-section .title{
		grid-column: 2;
	}
	/*cover to title gap is always 15px*/
	.medialist .listTable-section > .list-head > div.title,
	.medialist .listTable-section > .list-entries > .entry > div.title{
		padding-left: 15px;
	}
	/*AniList's spacing, until changed in the settings*/
	.medialist .listTable-section{
		--listTable-native-pad: 20px;
	}
	.medialist .listTable-tight .listTable-section{
		--listTable-cell-pad: 8px;/*the columns don't fit, see updateFit*/
	}
	.medialist.compact .listTable-section{
		--listTable-cover-width: 0px;
		--listTable-native-pad: 15px;
		--listTable-title-share: 4fr;
	}
}
.listTable-section .listTable-col{
	min-width: 0;
	overflow-wrap: anywhere;
}
.listTable-section .entry .listTable-col:not(.listTable-wide){
	white-space: nowrap;
}
.listTable-section .list-head .listTable-col{
	white-space: pre-line;
}
/*don't split header words*/
.medialist .listTable-section .list-head .listTable-col:not(.listTable-wide){
	overflow-wrap: normal;
	min-width: min-content;
}
.listTable-section .listTable-col.listTable-wide{
	flex: 2 1 0%;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	cursor: pointer;
}
.listTable-section .list-head .listTable-col.listTable-wide{
	cursor: default;
}
.listTable-section .listTable-col.listTable-wide.listTable-expanded{
	white-space: normal;
	overflow: visible;
}
.listTable-section .listTable-hover-icon{
	margin-left: 10px;
}
.listTable-section .listTable-hover-icon.clickable{
	cursor: pointer;
}
.listTable-section .listTable-hover-icon .hover-icon-target{
	display: inline-flex;
	align-items: center;
	width: max-content;
}
.listTable-section.listTable-scroll{
	overflow-x: auto;
}
.listTable-section.listTable-scroll .entry:hover .cover .image{
	position: fixed !important;
	left: var(--listTable-cover-x) !important;
	top: var(--listTable-cover-y) !important;
}
.listTable-section .listTable-sentinel{
	height: 1px;
}
.listTable-columns-button{
	cursor: pointer;
}
.listTable-panel{
	position: absolute;
	z-index: 1000;
	width: 340px;
	max-height: 75vh;
	overflow-y: auto;
	padding: 16px 18px;
	border-radius: 4px;
	background: rgb(var(--color-foreground));
	color: rgb(var(--color-text));
	box-shadow: 0 14px 30px rgba(var(--color-shadow-dark, 49,54,68),.15), 0 4px 6px rgba(var(--color-shadow-dark, 49,54,68),.05);
	font-size: 1.3rem;
}
.listTable-enable{
	display: flex;
	align-items: center;
	gap: 6px;
	font-weight: 600;
	cursor: pointer;
	color: rgb(var(--color-text));
}
.listTable-settings > .listTable-settings-help:first-of-type{
	margin-bottom: 12px;
}
/*still editable while the table is off*/
.listTable-column-list.listTable-off{
	opacity: 0.5;
}
.listTable-settings-top{
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 6px;
}
.listTable-settings-title{
	font-weight: 600;
	font-size: 1.4rem;
	color: rgb(var(--color-text));
}
.listTable-tabs .listTable-tab{
	cursor: pointer;
	padding: 3px 8px;
	border-radius: 3px;
	color: rgb(var(--color-text-lighter));
}
.listTable-tabs .listTable-tab.active{
	background: rgb(var(--color-blue));
	color: rgb(var(--color-white));
}
.listTable-settings-help{
	margin: 4px 0 8px;
	color: rgb(var(--color-text-lighter));
	font-size: 1.2rem;
}
.listTable-column-list{
	list-style: none;
	margin: 0;
	padding: 0;
}
.listTable-column{
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 5px 6px;
	border-radius: 3px;
	background: rgb(var(--color-background));
	margin-bottom: 4px;
	user-select: none;
}
.listTable-column:not(.listTable-on) label{
	color: rgb(var(--color-text-lighter));
}
.listTable-column.listTable-dragging{
	background: rgb(var(--color-blue));
	color: rgb(var(--color-white));
	box-shadow: 0 4px 12px rgba(0,0,0,.25);
	position: relative;
	z-index: 1;
}
.listTable-column.listTable-dragging label,
.listTable-column.listTable-dragging .listTable-hint,
.listTable-column.listTable-dragging .listTable-handle{
	color: rgb(var(--color-white));
}
.listTable-column label{
	display: flex;
	align-items: center;
	gap: 6px;
	cursor: pointer;
	flex: 1;
}
.listTable-handle{
	color: rgb(var(--color-text-lighter));
	cursor: grab;
	touch-action: none;
	padding: 0 4px;
	font-size: 1.6rem;
}
.listTable-column.listTable-dragging .listTable-handle{
	cursor: grabbing;
}
.listTable-hint{
	margin-left: auto;
	font-size: 1.1rem;
	color: rgb(var(--color-text-lighter));
}
.listTable-settings-style{
	margin-top: 14px;
}
.listTable-settings-subtitle{
	margin: 0 0 4px;
	font-weight: 600;
	color: rgb(var(--color-text));
}
.listTable-settings-style p{
	margin: 8px 0 0;
}
.listTable-slider-row{
	display: flex;
	align-items: center;
	gap: 8px;
}
.listTable-slider-label{
	width: 110px;
	flex: none;
}
.listTable-slider{
	flex: 1;
	min-width: 0;
	accent-color: rgb(var(--color-blue));
}
.medialist .listTable-section .entry > .progress{
	white-space: nowrap;
}
/*the hover "+" must not take room, or it wraps*/
.medialist .listTable-section .entry .plus-progress{
	position: absolute;
	left: auto;
	bottom: auto;
	width: auto;
	padding: 0 0 0 3px;
	background: none;
	white-space: nowrap;
}
.listTable-slider-reset{
	flex: none;
	align-self: center;
	margin: 0 !important;
	padding: 0 8px;
	height: 24px;
	line-height: 24px;
	font-size: 1.2rem;
}
.listTable-slider-value{
	width: 56px;
	flex: none;
	text-align: right;
	color: rgb(var(--color-text-lighter));
}
.listTable-settings-style .listTable-settings-help{
	margin-top: 6px;
}
.listTable-settings-other p{
	margin: 10px 0 0;
}
.listTable-settings-other .listTable-select{
	margin-left: 4px;
}
.listTable-settings-other .listTable-reset{
	margin-top: 10px;
}
.listTable-settings-other .listTable-reset.listTable-confirm{
	background: rgb(var(--color-red));
	color: rgb(var(--color-white));
}
#hohSettings .listTable-settings{
	max-width: 420px;
}
`
});
