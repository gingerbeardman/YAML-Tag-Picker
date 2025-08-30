exports.activate = function() {
	nova.commands.register("jekyll-tag-picker.selectTags", (editor) => selectTags(editor));
	nova.commands.register("jekyll-tag-picker.createTagAuditDocument", (editor) => createTagAuditDocument(editor));
	nova.commands.register("jekyll-tag-picker.addCreationDate", (editor) => addCreationDate(editor));
	nova.commands.register("jekyll-tag-picker.addModifiedDate", (editor) => addModifiedDate(editor));
}

async function selectTags(editor) {
	const workspace = nova.workspace;
	if (!workspace) {
		nova.workspace.showErrorMessage("No active workspace found.");
		return;
	}

	const blogPath = workspace.path;
	if (!blogPath) {
		nova.workspace.showErrorMessage("Unable to determine workspace path.");
		return;
	}

	// console.log("Workspace path:", blogPath);

	// Get the settings
	const postsFolderName = nova.config.get("jekyll-tag-picker.postsFolderName") || "_posts";
	const skipCharacter = nova.config.get("jekyll-tag-picker.skipCharacter") || "'";

	try {
		const allTags = await getAllTags(blogPath, postsFolderName);
		// console.log("Found tags:", allTags);
		if (allTags.length === 0) {
			nova.workspace.showErrorMessage("No tags found in your Jekyll blog posts.");
			return;
		}

		// Filter out tags starting with the skip character and sort the remaining tags
		const filteredAndSortedTags = allTags
			.filter(tag => !tag.startsWith(skipCharacter))
			.sort((a, b) => a.localeCompare(b));
		// console.log("Filtered and sorted tags:", filteredAndSortedTags);

		if (filteredAndSortedTags.length === 0) {
			nova.workspace.showErrorMessage("No valid tags found after filtering.");
			return;
		}

		const selectedTags = await selectMultipleTags(filteredAndSortedTags);
		// console.log("Selected tags:", selectedTags);

		if (selectedTags.length > 0) {
			// Get the tag prefix from settings
			const tagPrefix = nova.config.get("jekyll-tag-picker.tagPrefix") || "-";

			// Insert selected tags into the current document
			if (editor) {
				const insertion = selectedTags.map(tag => `${tagPrefix} ${tag}`).join('\n');
				const range = editor.selectedRange;
				editor.edit((e) => {
					e.insert(range.start, insertion + '\n');
				});
				// console.log("Inserted tags:", selectedTags);
			} else {
				// console.log("No active editor found to insert tags");
			}
		} else {
			// console.log("No tags were selected");
		}
	} catch (error) {
		console.error("Error in tag selection process:", error);
		nova.workspace.showErrorMessage("Error in tag selection process: " + error.message);
	}
}

async function selectMultipleTags(allTags) {
	const selectedTags = [];
	let continuing = true;

	while (continuing) {
		const remainingTags = allTags.filter(tag => !selectedTags.includes(tag));
		
		if (remainingTags.length === 0) {
			nova.workspace.showInformativeMessage("All tags have been selected.");
			break;
		}

		const choices = ["Finish Selection", ...remainingTags];
		const selection = await new Promise((resolve) => {
			nova.workspace.showChoicePalette(
				choices,
				{ placeholder: "Select a tag or finish (or Esc)" },
				(choice) => resolve(choice)
			);
		});

		if (selection === undefined || selection === null) {
			// User pressed Esc, cancel the whole process
			// console.log("Selection cancelled");
			continuing = false;
		} else if (selection === "Finish Selection") {
			// console.log("Selection finished");
			continuing = false;
		} else {
			selectedTags.push(selection);
			// console.log(`Selected tag: ${selection}`);
		}
	}

	// console.log("Final selected tags:", selectedTags);
	return selectedTags;
}

async function getAllTags(blogPath, postsFolderName) {
	const postsDir = nova.path.join(blogPath, postsFolderName);
	// console.log("Posts directory:", postsDir);
	const tags = new Set();

	try {
		await processDirectory(postsDir, tags);
	} catch (error) {
		console.error("Error reading blog posts:", error);
		throw error;
	}

	return Array.from(tags);
}

async function processDirectory(dir, tags) {
	// console.log("Processing directory:", dir);
	const entries = await nova.fs.listdir(dir);
	
	for (const entry of entries) {
		const fullPath = nova.path.join(dir, entry);
		const stats = await nova.fs.stat(fullPath);
		
		if (stats.isDirectory()) {
			await processDirectory(fullPath, tags);
		} else if (stats.isFile() && (entry.endsWith('.md') || entry.endsWith('.markdown'))) {
			// console.log("Processing file:", fullPath);
			try {
				const file = await nova.fs.open(fullPath, 'r');
				const content = await file.readlines().join('\n');
				file.close();
				const frontMatter = extractFrontMatter(content);
				if (frontMatter) {
					// console.log("Extracted front matter:", frontMatter);
					if (frontMatter.tags) {
						// console.log("Tags found in file:", frontMatter.tags);
						addTags(frontMatter.tags, tags);
					} else {
						// console.log("No tags found in this file");
					}
				} else {
					// console.log("No front matter found in this file");
				}
			} catch (error) {
				console.error("Error reading file:", fullPath, error);
			}
		} else {
			// console.log("Skipping non-markdown file:", fullPath);
		}
	}
}

function extractFrontMatter(content) {
	const frontMatterRegex = /^---\s*\n([\s\S]*?)\n---/;
	const match = content.match(frontMatterRegex);
	if (match) {
		try {
			return parseYAML(match[1]);
		} catch (error) {
			console.error("Error parsing front matter:", error);
		}
	}
	return null;
}

function addTags(fileTags, tagSet) {
	if (Array.isArray(fileTags)) {
		fileTags.forEach(tag => tagSet.add(tag.trim()));
	} else if (typeof fileTags === 'string') {
		// Handle comma-separated string or single tag
		fileTags.split(',').forEach(tag => tagSet.add(tag.trim()));
	} else if (typeof fileTags === 'object') {
		// Handle YAML parsed object (e.g., tags: [tag1, tag2, tag3])
		Object.values(fileTags).forEach(tag => tagSet.add(tag.trim()));
	}
}

function parseYAML(yamlString) {
	// console.log("Parsing YAML:", yamlString);
	const lines = yamlString.split('\n');
	const result = {};
	let currentKey = null;
	let inArray = false;

	lines.forEach(line => {
		line = line.trim();
		if (line === '') return;

		if (line.startsWith('-') && currentKey) {
			// This is an array item
			if (!result[currentKey]) {
				result[currentKey] = [];
			}
			result[currentKey].push(line.slice(1).trim());
			inArray = true;
		} else {
			const colonIndex = line.indexOf(':');
			if (colonIndex !== -1) {
				// This is a new key-value pair
				currentKey = line.slice(0, colonIndex).trim();
				let value = line.slice(colonIndex + 1).trim();
				if (value.startsWith('[') && value.endsWith(']')) {
					// Handle inline array
					value = value.slice(1, -1).split(',').map(item => item.trim());
				}
				result[currentKey] = value || [];
				inArray = false;
			} else if (inArray && currentKey) {
				// This is a continuation of the previous array
				result[currentKey].push(line);
			}
		}
	});

	// console.log("Parsed YAML result:", result);
	return result;
}

async function createTagAuditDocument() {
	const workspace = nova.workspace;
	if (!workspace) {
		nova.workspace.showErrorMessage("No active workspace found.");
		return;
	}

	const blogPath = workspace.path;
	if (!blogPath) {
		nova.workspace.showErrorMessage("Unable to determine workspace path.");
		return;
	}

	const postsFolderName = nova.config.get("jekyll-tag-picker.postsFolderName") || "_posts";

	try {
		const allTags = await getAllTags(blogPath, postsFolderName);
		if (allTags.length === 0) {
			nova.workspace.showErrorMessage("No tags found in your Jekyll blog posts.");
			return;
		}

		// Sort tags alphabetically
		const sortedTags = allTags.sort((a, b) => a.localeCompare(b));

		// Prepare the content for the new document
		const content = "# YAML Tag Audit\n\nTotal unique tags: " + sortedTags.length + "\n\n" + sortedTags.join("\n");

		// Create a new document with the prepared content
		await nova.workspace.openNewTextDocument({
			content: content,
			syntax: "markdown"
		});
	} catch (error) {
		console.error("Error in creating tags audit:", error);
		nova.workspace.showErrorMessage("Error in creating tags audit: " + error.message);
	}
}

async function addCreationDate(editor) {
	if (!editor) {
		nova.workspace.showErrorMessage("No active editor found.");
		return;
	}

	const currentDate = formatDateForYAML(new Date());
	await addOrReplaceDateField(editor, 'date', currentDate);
}

async function addModifiedDate(editor) {
	if (!editor) {
		nova.workspace.showErrorMessage("No active editor found.");
		return;
	}

	const currentDate = formatDateForYAML(new Date());
	await addOrReplaceDateField(editor, 'modified', currentDate);
}

function formatDateForYAML(date) {
	// Format: '2025-08-28T11:00+01:00'
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	
	// Get timezone offset in format +HH:MM or -HH:MM
	const timezoneOffset = date.getTimezoneOffset();
	const offsetHours = Math.floor(Math.abs(timezoneOffset) / 60);
	const offsetMinutes = Math.abs(timezoneOffset) % 60;
	const offsetSign = timezoneOffset <= 0 ? '+' : '-';
	const timezoneString = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`;
	
	return `'${year}-${month}-${day}T${hours}:${minutes}${timezoneString}'`;
}

async function addOrReplaceDateField(editor, fieldName, dateValue) {
	const document = editor.document;
	const content = document.getTextInRange(new Range(0, document.length));
	
	// Check if the document has YAML front matter
	const frontMatterRegex = /^---\s*\n([\s\S]*?)\n---/;
	const match = content.match(frontMatterRegex);
	
	if (!match) {
		nova.workspace.showErrorMessage("No YAML front matter found in the current document.");
		return;
	}
	
	const frontMatterContent = match[1];
	const frontMatterStart = match.index + 4; // Position after "---\n"
	const frontMatterEnd = frontMatterStart + frontMatterContent.length;
	
	// Check if the field already exists
	const fieldRegex = new RegExp(`^${fieldName}:\\s*.*$`, 'm');
	const fieldMatch = frontMatterContent.match(fieldRegex);
	
	editor.edit((edit) => {
		if (fieldMatch) {
			// Replace existing field
			const fieldStart = frontMatterStart + frontMatterContent.indexOf(fieldMatch[0]);
			const fieldEnd = fieldStart + fieldMatch[0].length;
			const newField = `${fieldName}: ${dateValue}`;
			edit.replace(new Range(fieldStart, fieldEnd), newField);
		} else {
			// Add new field - find the best position to insert it
			const lines = frontMatterContent.split('\n');
			let insertPosition = frontMatterStart;
			let insertAfterLine = -1;
			
			// Try to insert after title, or after layout, or at the beginning
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i].trim();
				if (line.startsWith('title:') || line.startsWith('layout:')) {
					insertAfterLine = i;
					break;
				}
			}
			
			if (insertAfterLine >= 0) {
				// Calculate position after the found line
				let pos = frontMatterStart;
				for (let i = 0; i <= insertAfterLine; i++) {
					pos += lines[i].length + 1; // +1 for newline
				}
				insertPosition = pos;
			}
			
			const newField = `${fieldName}: ${dateValue}\n`;
			edit.insert(insertPosition, newField);
		}
	});
}