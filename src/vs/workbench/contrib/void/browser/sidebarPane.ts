/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import {
	Extensions as ViewContainerExtensions, IViewContainersRegistry,
	ViewContainerLocation, IViewsRegistry, Extensions as ViewExtensions,
	IViewDescriptorService,
} from '../../../common/views.js';

import * as nls from '../../../../nls.js';

// import { Codicon } from '../../../../base/common/codicons.js';
// import { localize } from '../../../../nls.js';
// import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';

import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
// import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';


import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';

import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
// import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { mountSidebar } from './react/out/sidebar-tsx/index.js';

import { Orientation } from '../../../../base/browser/ui/sash/sash.js';
// import { IDisposable } from '../../../../base/common/lifecycle.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';

// compare against search.contribution.ts and debug.contribution.ts, scm.contribution.ts (source control)

// ---------- Define viewpane ----------

class SidebarViewPane extends ViewPane {

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IHoverService hoverService: IHoverService,
		@IVoidSettingsService private readonly _voidSettingsService: IVoidSettingsService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService)
		this._register(this._voidSettingsService.onDidChangeState(() => this._updateTitle()));
		this._updateTitle();
	}

	private _currentAnimationInterval: any = undefined;

	private _updateTitle() {
		const chatMode = this._voidSettingsService.state.globalSettings.chatMode;

		let newTitle = 'Ask';
		if (chatMode === 'ask') newTitle = 'Ask';
		else if (chatMode === 'copilot') newTitle = 'Copilot';
		else if (chatMode === 'reason') newTitle = 'Reasoning';
		else if (chatMode === 'validate') newTitle = 'Validation';
		else if (chatMode === 'agent') newTitle = 'Agent';
		else if (chatMode === 'gather') newTitle = 'Gather';

		if (this.title === newTitle) return;

		this._animateTitle(newTitle);
	}

	private _animateTitle(targetTitle: string) {
		if (this._currentAnimationInterval) {
			clearInterval(this._currentAnimationInterval);
			this._currentAnimationInterval = undefined;
		}

		// Typewriter effect:
		// 1. Delete current title char by char
		// 2. Type new title char by char
		// OR just type new title over if we want faster.
		// Let's do a "scramble" or "replace" style for "magic".
		// Actually, user asked for "magic animation". A simple typewriter is safest and looks cool.


		// const startTitle = this.title;
		let phase = 'deleting'; // 'deleting' | 'typing'

		// Optimization: Find common prefix?
		// e.g. "Agent" -> "Agent (Copilot)"
		// For now, let's just delete all and retype.

		this._currentAnimationInterval = setInterval(() => {
			const currentText = this.title;

			if (phase === 'deleting') {
				if (currentText.length > 0) {
					this.updateTitle(currentText.slice(0, -1));
				} else {
					phase = 'typing';
				}
			} else { // typing
				if (currentText.length < targetTitle.length) {
					this.updateTitle(targetTitle.slice(0, currentText.length + 1));
				} else {
					// Done
					clearInterval(this._currentAnimationInterval);
					this._currentAnimationInterval = undefined;
				}
			}
		}, 50); // 50ms per char
	}



	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		// parent.style.overflow = 'auto'
		parent.style.userSelect = 'text'

		// gets set immediately
		this.instantiationService.invokeFunction(accessor => {
			// mount react
			const disposeFn: (() => void) | undefined = mountSidebar(parent, accessor)?.dispose;
			this._register(toDisposable(() => disposeFn?.()))
		});
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width)
		this.element.style.height = `${height}px`
		this.element.style.width = `${width}px`
	}

}



// ---------- Register viewpane inside the void container ----------

// const voidThemeIcon = Codicon.symbolObject;
// const voidViewIcon = registerIcon('void-view-icon', voidThemeIcon, localize('voidViewIcon', 'View icon of the Void chat view.'));

// called VIEWLET_ID in other places for some reason
export const VOID_VIEW_CONTAINER_ID = 'workbench.view.void'
export const VOID_VIEW_ID = VOID_VIEW_CONTAINER_ID

// Register view container
const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const container = viewContainerRegistry.registerViewContainer({
	id: VOID_VIEW_CONTAINER_ID,
	title: nls.localize2('voidContainer', 'Agent'), // this is used to say "Void" (Ctrl + L)
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [VOID_VIEW_CONTAINER_ID, {
		mergeViewWithContainerWhenSingleView: true,
		orientation: Orientation.HORIZONTAL,
	}]),
	hideIfEmpty: false,
	order: 1,

	rejectAddedViews: true,



}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: true, isDefault: true });



// Register search default location to the container (sidebar)
const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
viewsRegistry.registerViews([{
	id: VOID_VIEW_ID,
	hideByDefault: false, // start open
	// containerIcon: voidViewIcon,
	name: nls.localize2('voidChat', ''), // this says ... : CHAT
	ctorDescriptor: new SyncDescriptor(SidebarViewPane),
	canToggleVisibility: false,
	canMoveView: false, // can't move this out of its container
	weight: 80,
	order: 1,
	// singleViewPaneContainerTitle: 'hi',

	// openCommandActionDescriptor: {
	// 	id: VOID_VIEW_CONTAINER_ID,
	// 	keybindings: {
	// 		primary: KeyMod.CtrlCmd | KeyCode.KeyL,
	// 	},
	// 	order: 1
	// },
}], container);


// open sidebar
export const VOID_OPEN_SIDEBAR_ACTION_ID = 'void.openSidebar'
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VOID_OPEN_SIDEBAR_ACTION_ID,
			title: 'Open Void Sidebar',
		})
	}
	run(accessor: ServicesAccessor): void {
		const viewsService = accessor.get(IViewsService)
		viewsService.openViewContainer(VOID_VIEW_CONTAINER_ID);
	}
});

export class SidebarStartContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.startupVoidSidebar';
	constructor(
		@ICommandService private readonly commandService: ICommandService,
	) {
		this.commandService.executeCommand(VOID_OPEN_SIDEBAR_ACTION_ID)
	}
}
registerWorkbenchContribution2(SidebarStartContribution.ID, SidebarStartContribution, WorkbenchPhase.AfterRestored);
