/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type * as vscode from 'vscode';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { nullExtensionDescription } from '../../../services/extensions/common/extensions.js';
import { MainThreadTaskShape } from '../../common/extHost.protocol.js';
import { TaskDTO, WorkerExtHostTask } from '../../common/extHostTask.js';
import { IExtHostTerminalService } from '../../common/extHostTerminalService.js';
import { CustomExecution, Task, TaskScope } from '../../common/extHostTypes.js';
import { ITaskDTO } from '../../common/shared/tasks.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';

suite('ExtHostTask custom execution ownership', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	class TestExtHostTask extends WorkerExtHostTask {
		get executionIds(): string[] { return [...this._providedCustomExecutions2.keys()].sort(); }
		getExecution(id: string): CustomExecution | undefined { return this._providedCustomExecutions2.get(id); }
		dispose(): void {
			this._onDidExecuteTask.dispose();
			this._onDidTerminateTask.dispose();
			this._onDidTaskProcessStarted.dispose();
			this._onDidTaskProcessEnded.dispose();
			this._onDidStartTaskProblemMatchers.dispose();
			this._onDidEndTaskProblemMatchers.dispose();
		}
	}

	function createTaskService(createTaskId: (task: ITaskDTO) => Promise<string> = async task => { assert.ok(task.name); return task.name; }): TestExtHostTask {
		const proxy = new class extends mock<MainThreadTaskShape>() {
			override async $registerSupportedExecutions(): Promise<void> { }
			override $registerTaskSystem(): void { }
			override async $registerTaskProvider(): Promise<void> { }
			override async $unregisterTaskProvider(): Promise<void> { }
			override $createTaskId(task: ITaskDTO): Promise<string> { return createTaskId(task); }
		};
		const terminals = new class extends mock<IExtHostTerminalService>() {
			override attachPtyToTerminal(): void { }
			override getTerminalById(): null { return null; }
		};
		return store.add(new TestExtHostTask(
			SingleProxyRPCProtocol(proxy), undefined!, undefined!, undefined!, undefined!, terminals,
			store.add(new NullLogService()), undefined!
		));
	}

	function customTask(name = 'first'): Task {
		return new Task({ type: 'test' }, TaskScope.Workspace, name, 'test', new CustomExecution(async () => ({
			onDidWrite: Event.None, open() { }, close() { }
		})));
	}

	function register(service: TestExtHostTask, task: Task): vscode.Disposable {
		return store.add(service.registerTaskProvider(nullExtensionDescription, 'test', {
			provideTasks: () => [task], resolveTask: () => undefined
		}));
	}

	test('removes only the disposed provider custom executions', async () => {
		const service = createTaskService();
		const first = register(service, customTask());
		const second = register(service, customTask('second'));
		await service.$provideTasks(0, { test: true });
		await service.$provideTasks(1, { test: true });
		first.dispose();
		assert.deepStrictEqual(service.executionIds, ['second']);
		second.dispose();
		assert.deepStrictEqual(service.executionIds, []);
	});

	test('does not delete a replacement from another provider', async () => {
		const service = createTaskService();
		const first = register(service, customTask());
		const replacement = customTask();
		const second = register(service, replacement);
		await service.$provideTasks(0, { test: true });
		await service.$provideTasks(1, { test: true });
		first.dispose();
		assert.strictEqual(service.getExecution('first'), replacement.execution);
		second.dispose();
		assert.deepStrictEqual(service.executionIds, []);
	});

	test('does not delete a callback still shared by another provider', async () => {
		const service = createTaskService();
		const task = customTask();
		const first = register(service, task);
		const second = register(service, task);
		await service.$provideTasks(0, { test: true });
		await service.$provideTasks(1, { test: true });
		first.dispose();
		assert.strictEqual(service.getExecution('first'), task.execution);
		second.dispose();
		assert.deepStrictEqual(service.executionIds, []);
	});

	test('does not retain tasks returned after provider disposal', async () => {
		const service = createTaskService();
		const result = new DeferredPromise<Task[]>();
		const registration = store.add(service.registerTaskProvider(nullExtensionDescription, 'test', {
			provideTasks: () => result.p, resolveTask: () => undefined
		}));
		const pending = service.$provideTasks(0, { test: true });
		registration.dispose();
		await result.complete([customTask()]);
		await pending;
		assert.deepStrictEqual(service.executionIds, []);
	});

	test('does not retain a task ID calculated after provider disposal', async () => {
		const id = new DeferredPromise<string>();
		const requested = new DeferredPromise<void>();
		const service = createTaskService(() => { requested.complete(); return id.p; });
		const registration = register(service, customTask());
		const pending = service.$provideTasks(0, { test: true });
		await requested.p;
		registration.dispose();
		await id.complete('first');
		await pending;
		assert.deepStrictEqual(service.executionIds, []);
	});

	test('removes custom executions registered by resolveTask', async () => {
		const service = createTaskService();
		const registration = store.add(service.registerTaskProvider(nullExtensionDescription, 'test', {
			provideTasks: () => [],
			resolveTask: task => { task.execution = customTask().execution; return task; }
		}));
		await service.$resolveTask(0, TaskDTO.from(customTask(), nullExtensionDescription)!);
		assert.deepStrictEqual(service.executionIds, ['first']);
		registration.dispose();
		assert.deepStrictEqual(service.executionIds, []);
	});

	test('does not retain a resolution returned after provider disposal', async () => {
		const service = createTaskService();
		const result = new DeferredPromise<Task>();
		const requested = new DeferredPromise<Task>();
		const registration = store.add(service.registerTaskProvider(nullExtensionDescription, 'test', {
			provideTasks: () => [],
			resolveTask: task => { requested.complete(task as Task); return result.p; }
		}));
		const pending = service.$resolveTask(0, TaskDTO.from(customTask(), nullExtensionDescription)!);
		const task = await requested.p;
		registration.dispose();
		task.execution = customTask().execution;
		await result.complete(task);
		await pending;
		assert.deepStrictEqual(service.executionIds, []);
	});

	test('returns retired task ownership to a newly registered provider', async () => {
		const service = createTaskService();
		const task = customTask();
		const first = register(service, task);
		await service.$provideTasks(0, { test: true });
		const execution = { id: 'first', task: { ...TaskDTO.from(task, nullExtensionDescription)!, _id: 'first' } };
		await service.$onDidStartTask(execution, 1, task.definition);
		first.dispose();
		const replacement = customTask();
		register(service, replacement);
		await service.$provideTasks(1, { test: true });
		const secondTask = customTask('second');
		register(service, secondTask);
		await service.$provideTasks(2, { test: true });
		const secondExecution = { id: 'second', task: { ...TaskDTO.from(secondTask, nullExtensionDescription)!, _id: 'second' } };
		await service.$onDidStartTask(secondExecution, 2, secondTask.definition);
		await service.$OnDidEndTask(execution);
		assert.strictEqual(service.getExecution('first'), replacement.execution);
		await service.$OnDidEndTask(secondExecution);
		assert.strictEqual(service.getExecution('first'), replacement.execution);
	});

	test('preserves active and last-started callbacks until ordinary execution cleanup', async () => {
		const service = createTaskService();
		const firstTask = customTask();
		const first = register(service, firstTask);
		const secondTask = customTask('second');
		const second = register(service, secondTask);
		await service.$provideTasks(0, { test: true });
		await service.$provideTasks(1, { test: true });
		const firstExecution = { id: 'first', task: { ...TaskDTO.from(firstTask, nullExtensionDescription)!, _id: 'first' } };
		const secondExecution = { id: 'second', task: { ...TaskDTO.from(secondTask, nullExtensionDescription)!, _id: 'second' } };
		await service.$onDidStartTask(firstExecution, 1, firstTask.definition);
		first.dispose();
		assert.strictEqual(service.getExecution('first'), firstTask.execution);
		await service.$OnDidEndTask(firstExecution);
		assert.strictEqual(service.getExecution('first'), firstTask.execution, 'the last task can still be rerun');
		await service.$onDidStartTask(secondExecution, 2, secondTask.definition);
		second.dispose();
		await service.$OnDidEndTask(secondExecution);
		assert.deepStrictEqual(service.executionIds, ['second']);
	});
});
