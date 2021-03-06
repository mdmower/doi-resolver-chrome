/*!
	Copyright (C) 2016 Matthew D. Mower

	Licensed under the Apache License, Version 2.0 (the "License");
	you may not use this file except in compliance with the License.
	You may obtain a copy of the License at

		 http://www.apache.org/licenses/LICENSE-2.0

	Unless required by applicable law or agreed to in writing, software
	distributed under the License is distributed on an "AS IS" BASIS,
	WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	See the License for the specific language governing permissions and
	limitations under the License.
*/

document.addEventListener('DOMContentLoaded', function () {
	beginInit();
}, false);

function beginInit() {
	restoreOptions();
	getLocalMessages();
	showHideOptionalElms();
	populateHistory();
	startListeners();
}

function startListeners() {
	var resolveSubmit = document.getElementById("resolveSubmit");
	resolveSubmit.addEventListener("click", function() {
		document.getElementById("hiddenButtonInput").value = "doi";
	});
	var citeSubmit = document.getElementById("citeSubmit");
	citeSubmit.addEventListener("click", function() {
		document.getElementById("hiddenButtonInput").value = "cite";
	});
	var qrSubmit = document.getElementById("qrSubmit");
	qrSubmit.addEventListener("click", function() {
		document.getElementById("hiddenButtonInput").value = "qr";
	});
	var optionsSubmit = document.getElementById("optionsSubmit");
	optionsSubmit.addEventListener("click", function() {
		document.getElementById("hiddenButtonInput").value = "options";
	});
	var doiForm = document.getElementById("doiForm");
	doiForm.addEventListener("submit", function(event) {
		event.preventDefault();
		formSubmitHandler();
	});
	var crRadioOptions = Array.from(document.querySelectorAll('input[name="crRadio"]'));
	crRadioOptions.forEach(function(crRadio) {
		crRadio.addEventListener("click", saveOptions);
	});
}

function saveOptions() {
	var options = {
		cr_bubble_last: document.querySelector('input[name="crRadio"]:checked').value
	};

	chrome.storage.local.set(options, null);
}

function restoreOptions() {
	chrome.storage.local.get(["cr_bubble_last"], function(stg) {
		if (stg.cr_bubble_last === "custom") {
			document.getElementById("crRadioBubbleCustom").checked = true;
		} else {
			document.getElementById("crRadioBubbleDefault").checked = true;
		}
	});
}

// Clear message space
function resetMessageSpace() {
	var messageDiv = document.getElementById("messageDiv");
	messageDiv.innerHTML = "";
	messageDiv.style.display = "none";
}

// General messaging area in bubble
function bubbleMessage(message) {
	resetMessageSpace();
	var messageDiv = document.getElementById("messageDiv");
	messageDiv.innerHTML = message;
	messageDiv.style.display = "block";
}

function setDoiMetaPermissions(enable) {
	return new Promise((resolve) => {
		if (enable === undefined) {
			var stgFetch = [
				"history",
				"history_fetch_title"
			];

			chrome.storage.local.get(stgFetch, function(stg) {
				resolve(stg.history === true && stg.history_fetch_title === true);
			});
		} else {
			resolve(enable);
		}
	})
	.then(function(enable) {
		return new Promise((resolve) => {
			if (enable) {
				chrome.permissions.request({
					origins: [
						"https://*.doi.org/",
						"https://*.crossref.org/",
						"https://*.datacite.org/",
						"https://*.medra.org/"
					]
				}, resolve);
			} else {
				chrome.permissions.remove({
					origins: [
						"https://*.doi.org/",
						"https://*.crossref.org/",
						"https://*.datacite.org/",
						"https://*.medra.org/"
					]
				}, resolve);
			}
		});
	});
}

// Process the form
function formSubmitHandler() {
	var trim = chrome.extension.getBackgroundPage().trim;
	var actionType = document.getElementById("hiddenButtonInput").value;
	var doiInput = encodeURI(trim(document.getElementById("textInput").value));
	var checkValidDoi = chrome.extension.getBackgroundPage().checkValidDoi;
	var recordDoiAction = chrome.extension.getBackgroundPage().recordDoiAction;

	switch (actionType) {
	case "qr":
		if (checkValidDoi(doiInput)) {
			// Allow DOI recording to happen asynchronously
			setDoiMetaPermissions()
			.then(function () {
				recordDoiAction(doiInput);
			})
			.then(function () {
				qrGen(doiInput);
			});
		} else {
			// Allow tab to open with invalid DOI
			qrGen(doiInput);
		}
		break;
	case "cite":
		if (checkValidDoi(doiInput)) {
			// Allow DOI recording to happen asynchronously
			setDoiMetaPermissions()
			.then(function () {
				recordDoiAction(doiInput);
			})
			.then(function () {
				citeDOI(doiInput);
			});
		} else {
			// Allow tab to open with invalid DOI
			citeDOI(doiInput);
		}
		break;
	case "doi":
		if (!checkValidDoi(doiInput)) {
			bubbleMessage(chrome.i18n.getMessage("invalidDoiAlert"));
			return;
		}
		// Allow DOI recording to happen asynchronously
		setDoiMetaPermissions()
		.then(function () {
			recordDoiAction(doiInput);
		})
		.then(function () {
			resolveURL(doiInput);
		});
		break;
	case "options":
		if (chrome.runtime.openOptionsPage) {
			chrome.runtime.openOptionsPage(function() {
				window.close();
			});
		} else {
			chrome.tabs.create({url:"options.html"});
			window.close();
		}
		break;
	default:
		break;
	}
}

// Build URL based on custom resolver settings
function resolveURL(doi) {
	var stgFetch = [
		"custom_resolver",
		"cr_bubble",
		"cr_bubble_last",
		"doi_resolver",
		"shortdoi_resolver"
	];

	chrome.storage.local.get(stgFetch, function(stg) {
		var cr = stg.custom_resolver;
		var crb = stg.cr_bubble;
		var crbl = stg.cr_bubble_last;
		var useCustomResolver = false;

		if (cr === true) {
			if (crb === "custom" || (crb === "selectable" && crbl === "custom")) {
				useCustomResolver = true;
			}
		}

		var resolveDOI = chrome.extension.getBackgroundPage().resolveDOI;
		resolveDOI(doi, useCustomResolver, "newForegroundTab");

		window.close();
	});
}

// Open citation formatting page
function citeDOI(doiInput) {
	var citeUrl= "citation.html?doi=" + doiInput;
	chrome.tabs.create({url: citeUrl});
	window.close();
}

// Open QR generator page
function qrGen(doiInput) {
	var qrUrl = "qr.html?doi=" + doiInput;
	chrome.tabs.create({url: qrUrl});
	window.close();
}

// Show or hide additional buttons in bubble
function showHideOptionalElms() {
	var stgFetch = [
		"meta_buttons",
		"custom_resolver",
		"cr_bubble"
	];

	chrome.storage.local.get(stgFetch, function(stg) {
		document.getElementById("metaButtons").style.display = stg.meta_buttons ? "flex" : "";

		if (stg.custom_resolver && stg.cr_bubble === "selectable") {
			document.getElementById("crRadios").style.display = "block";
		} else {
			document.getElementById("crRadios").style.display = "";
		}
	});
}

function populateHistory() {
	var stgFetch = [
		"meta_buttons",
		"history",
		"recorded_dois",
		"history_showsave",
		"history_showtitles",
		"history_sortby"
	];

	chrome.storage.local.get(stgFetch, function(stg) {
		if (!stg.meta_buttons || !stg.history) {
			document.getElementById('historyDiv').style.display = '';
			return;
		}
		if (!Array.isArray(stg.recorded_dois) || stg.recorded_dois.length < 1) {
			document.getElementById('historyDiv').style.display = '';
			return;
		}

		document.getElementById('historyDiv').style.display = 'block';

		// Skip holes in the array (should not occur)
		stg.recorded_dois = stg.recorded_dois.filter(function(elm) {
			// Use !=, not !==, so that null is caught as well
			return elm != undefined;
		});

		var sortHistoryEntries = chrome.extension.getBackgroundPage().sortHistoryEntries;
		sortHistoryEntries(stg.recorded_dois, stg.history_sortby);

		var escapeHtml = chrome.extension.getBackgroundPage().escapeHtml;
		var optionHtml = "";

		stg.recorded_dois.filter(item => item.save).forEach((item) => {
			var label = stg.history_showtitles && item.title ? escapeHtml(item.title) : item.doi;
			optionHtml += '<option class="save" value="' + item.doi + '">' + label + '</option>';
		});
		optionHtml += optionHtml ? "<option disabled></option>" : "";

		if (stg.history_showsave !== true) {
			stg.recorded_dois.filter(item => !item.save).forEach((item) => {
				var label = stg.history_showtitles && item.title ? escapeHtml(item.title) : item.doi;
				optionHtml += '<option value="' + item.doi + '">' + label + '</option>';
			});
		}

		var selectBox = document.getElementById("doiHistory");
		var selectBoxSize = stg.recorded_dois.length > 6 ? 6 : stg.recorded_dois.length;
		selectBoxSize = selectBoxSize < 2 ? 2 : selectBoxSize;
		selectBox.setAttribute('size', selectBoxSize);
		selectBox.selectedIndex = -1;
		selectBox.innerHTML = optionHtml;

		var filterSelectByText = chrome.extension.getBackgroundPage().filterSelectByText;
		var filterInput = function() {
			filterSelectByText(selectBox, this.value, false);
		};

		var filter = document.getElementById("textInput");
		filter.addEventListener('input', filterInput);

		selectBox.addEventListener('change', function() {
			filter.removeEventListener('input', filterInput);
			filter.value = this.value;
			filter.addEventListener('input', filterInput);
			this.selectedIndex = -1;
			resetMessageSpace();
		});
	});
}

function getLocalMessages() {
	var messageIds = [
		"citeSubmit",
		"optionCrCustom",
		"optionCrDefault",
		"optionCrLabelBubble",
		"optionsSubmit",
		"qrSubmit",
		"resolveSubmit"
	];

	var message = "";
	for (var i = 0; i < messageIds.length; i++) {
		message = chrome.i18n.getMessage(messageIds[i]);
		document.getElementById(messageIds[i]).innerHTML = message;
	}
}
