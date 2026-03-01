class TaskHandler {
  constructor(bot, db) {
    this.bot = bot;
    this.db = db;
    this.taskCreationState = new Map();
    this.currentTaskIndex = new Map();
  }

  async showTaskDashboard(chatId) {
    try {
      // Get all active tasks
      const tasksSnapshot = await this.db.collection('tasks')
        .where('active', '==', true)
        .where('deleted', '==', false)
        .get();
      
      if (tasksSnapshot.empty) {
        // Show empty task dashboard with option to create
        const emptyText = `
📋 Task Management

No tasks available.

Options:
• Click "Set New" to create a task
• Make sure pool is set with /set_pool
        `;

        await this.bot.sendMessage(chatId, emptyText, {
          parse_mode: '', // Disable markdown
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ Set New Task', callback_data: 'task_setnew' }],
              [{ text: '🔙 Back to Admin', callback_data: 'admin_dashboard' }]
            ]
          }
        });
        return;
      }
      
      // Store tasks and show first one
      const tasks = [];
      tasksSnapshot.forEach(doc => {
        tasks.push({ id: doc.id, ...doc.data() });
      });
      
      // Store tasks for this chat
      this.currentTaskIndex.set(chatId.toString(), 0);
      
      // Display first task
      await this.displayTask(chatId, tasks[0].id, tasks[0], tasks.length);
    } catch (error) {
      console.error('Task dashboard error:', error);
      await this.bot.sendMessage(chatId, 'Error loading task dashboard.');
    }
  }

  async displayTask(chatId, taskId, task, totalTasks = 1) {
    const taskText = `
📋 Task Details (${this.currentTaskIndex.get(chatId.toString()) + 1}/${totalTasks})

🆔 Task ID: ${taskId}
📝 Description: ${task.description}
🏆 Prize: ${task.prize}MB
📊 Limit: ${task.totalLimit || 'No limit'}
✅ Completed: ${task.completedCount || 0}/${task.totalLimit || '∞'}
📅 Created: ${new Date(task.createdAt).toLocaleDateString()}
    `;

    await this.bot.sendMessage(chatId, taskText, {
      parse_mode: '', // Disable markdown parsing
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🗑️ Delete', callback_data: `task_delete_${taskId}` },
            { text: '⏩ Next', callback_data: 'task_next' },
            { text: '⬅️ Prev', callback_data: 'task_prev' }
          ],
          [
            { text: '➕ Set New', callback_data: 'task_setnew' },
            { text: '👥 Completed By', callback_data: `task_completed_${taskId}` }
          ],
          [
            { text: '🔙 Back to Admin', callback_data: 'admin_dashboard' }
          ]
        ]
      }
    });
  }

  async startTaskCreation(chatId) {
    try {
      // Check if there's active pool
      const poolDoc = await this.db.collection('settings').doc('pool').get();
      const pool = poolDoc.exists ? poolDoc.data().amount : 0;
      
      if (pool === 0) {
        await this.bot.sendMessage(chatId, '❌ Cannot create task. Pool is empty. Set pool first with /set_pool');
        return;
      }
      
      await this.bot.sendMessage(chatId, '📝 Enter task description:');
      this.taskCreationState.set(chatId.toString(), { step: 'description' });
    } catch (error) {
      console.error('Task creation error:', error);
      await this.bot.sendMessage(chatId, 'Error starting task creation.');
    }
  }

  async handleTaskCreationInput(chatId, text) {
    const state = this.taskCreationState.get(chatId.toString());
    
    if (!state) return;

    try {
      switch (state.step) {
        case 'description':
          state.description = text;
          state.step = 'prize';
          
          // Get current pool
          const poolDoc = await this.db.collection('settings').doc('pool').get();
          const pool = poolDoc.exists ? poolDoc.data().amount : 0;
          
          await this.bot.sendMessage(chatId, `💰 Enter reward amount (MB). Current pool: ${pool}MB`);
          break;

        case 'prize':
          const prize = parseFloat(text);
          if (isNaN(prize) || prize <= 0) {
            await this.bot.sendMessage(chatId, 'Please enter a valid positive number');
            return;
          }
          
          state.prize = prize;
          state.step = 'limit';
          await this.bot.sendMessage(chatId, '📊 Enter total completion limit (0 for no limit):');
          break;

        case 'limit':
          const limit = parseInt(text);
          if (isNaN(limit) || limit < 0) {
            await this.bot.sendMessage(chatId, 'Please enter a valid number (0 for no limit)');
            return;
          }
          
          // Create task
          const taskId = Date.now().toString();
          await this.db.collection('tasks').doc(taskId).set({
            id: taskId,
            description: state.description,
            prize: state.prize,
            totalLimit: limit === 0 ? null : limit,
            completedCount: 0,
            active: true,
            deleted: false,
            completedBy: [],
            createdAt: new Date().toISOString()
          });
          
          await this.bot.sendMessage(chatId, '✅ Task created successfully!');
          this.taskCreationState.delete(chatId.toString());
          
          // Show updated task dashboard
          await this.showTaskDashboard(chatId);
          break;
      }
    } catch (error) {
      console.error('Task creation input error:', error);
      await this.bot.sendMessage(chatId, 'Error creating task.');
      this.taskCreationState.delete(chatId.toString());
    }
  }

  async deleteTask(taskId, chatId) {
    try {
      await this.db.collection('tasks').doc(taskId).update({
        deleted: true,
        active: false
      });
      
      await this.bot.sendMessage(chatId, '✅ Task deleted successfully!');
      await this.showTaskDashboard(chatId);
    } catch (error) {
      console.error('Delete task error:', error);
      await this.bot.sendMessage(chatId, 'Error deleting task.');
    }
  }

  async navigateTask(chatId, direction) {
    try {
      const tasksSnapshot = await this.db.collection('tasks')
        .where('active', '==', true)
        .where('deleted', '==', false)
        .get();
      
      const tasks = [];
      tasksSnapshot.forEach(doc => tasks.push({ id: doc.id, ...doc.data() }));
      
      if (tasks.length === 0) {
        await this.showTaskDashboard(chatId);
        return;
      }
      
      let currentIndex = this.currentTaskIndex.get(chatId.toString()) || 0;
      
      if (direction === 'next') {
        currentIndex = (currentIndex + 1) % tasks.length;
      } else if (direction === 'prev') {
        currentIndex = (currentIndex - 1 + tasks.length) % tasks.length;
      }
      
      this.currentTaskIndex.set(chatId.toString(), currentIndex);
      await this.displayTask(chatId, tasks[currentIndex].id, tasks[currentIndex], tasks.length);
      
    } catch (error) {
      console.error('Navigate task error:', error);
      await this.bot.sendMessage(chatId, 'Error navigating tasks.');
    }
  }

  async showCompletedBy(taskId, chatId) {
    try {
      const taskDoc = await this.db.collection('tasks').doc(taskId).get();
      const task = taskDoc.data();
      
      if (!task.completedBy || task.completedBy.length === 0) {
        await this.bot.sendMessage(chatId, 'No users have completed this task yet.');
        return;
      }
      
      let completedText = `👥 Users who completed Task ${taskId}\n\n`;
      
      for (const userId of task.completedBy) {
        const userDoc = await this.db.collection('users').doc(userId).get();
        if (userDoc.exists) {
          const user = userDoc.data();
          completedText += `• @${user.username} - ${user.xUsername}\n`;
        }
      }
      
      await this.bot.sendMessage(chatId, completedText, { 
        parse_mode: '' // Disable markdown parsing
      });
    } catch (error) {
      console.error('Show completed by error:', error);
      await this.bot.sendMessage(chatId, 'Error loading completed users.');
    }
  }

  async completeTask(userId, taskId, chatId) {
  try {
    // Get task
    const taskDoc = await this.db.collection('tasks').doc(taskId).get();
    
    if (!taskDoc.exists) {
      await this.bot.sendMessage(chatId, 'Task not found.');
      return;
    }
    
    const task = taskDoc.data();
    
    if (!task || !task.active || task.deleted) {
      await this.bot.sendMessage(chatId, 'This task is no longer available.');
      return;
    }
    
    // Check if user already completed
    if (task.completedBy && task.completedBy.includes(userId.toString())) {
      await this.bot.sendMessage(chatId, 'You have already completed this task.');
      return;
    }
    
    // Check task limit
    if (task.totalLimit && task.completedCount >= task.totalLimit) {
      await this.bot.sendMessage(chatId, 'This task has reached its completion limit.');
      return;
    }
    
    // Get pool
    const poolDoc = await this.db.collection('settings').doc('pool').get();
    const pool = poolDoc.exists ? poolDoc.data().amount : 0;
    
    if (pool < task.prize) {
      await this.bot.sendMessage(chatId, '❌ Not enough pool balance to complete this task.');
      return;
    }
    
    // Start a Firestore batch for atomic operations
    const batch = this.db.batch();
    
    // Update user balance
    const userRef = this.db.collection('users').doc(userId.toString());
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      await this.bot.sendMessage(chatId, 'User not found.');
      return;
    }
    
    const user = userDoc.data();
    batch.update(userRef, {
      balance: (user.balance || 0) + task.prize
    });
    
    // Update pool
    const poolRef = this.db.collection('settings').doc('pool');
    batch.update(poolRef, {
      amount: pool - task.prize
    });
    
    // Update task
    const taskRef = this.db.collection('tasks').doc(taskId);
    const completedBy = task.completedBy || [];
    completedBy.push(userId.toString());
    const completedCount = (task.completedCount || 0) + 1;
    
    if (task.totalLimit && completedCount >= task.totalLimit) {
      batch.update(taskRef, {
        completedBy: completedBy,
        completedCount: completedCount,
        active: false,
        deleted: true
      });
    } else {
      batch.update(taskRef, {
        completedBy: completedBy,
        completedCount: completedCount
      });
    }
    
    // Commit all changes atomically
    await batch.commit();
    
    // Send success message to user
    await this.bot.sendMessage(chatId, `✅ Task completed! You earned ${task.prize}MB!`);
    
    // Try to notify admins, but don't fail if it doesn't work
    try {
      const admins = process.env.ADMIN_IDS.split(',');
      for (const adminId of admins) {
        await this.bot.sendMessage(
          adminId,
          `✅ @${user.username} completed a task!\n\nTask: ${task.description}\nReward: ${task.prize}MB`
        ).catch(err => console.log('Failed to notify admin:', err.message));
      }
    } catch (adminError) {
      console.log('Admin notification error (non-critical):', adminError.message);
    }
    
  } catch (error) {
    console.error('Complete task error:', error);
    
    // Check if it's a network error
    if (error.message && error.message.includes('getaddrinfo')) {
      await this.bot.sendMessage(chatId, '⚠️ Task completed but there was a network issue. Your balance has been updated.');
    } else {
      await this.bot.sendMessage(chatId, 'Error completing task. Please try again.');
    }
  }
}

  async handleCallback(data, chatId, messageId) {
    try {
      if (data === 'task_next') {
        await this.navigateTask(chatId, 'next');
      } else if (data === 'task_prev') {
        await this.navigateTask(chatId, 'prev');
      } else if (data === 'task_setnew') {
        await this.startTaskCreation(chatId);
      } else if (data.startsWith('task_delete_')) {
        const taskId = data.replace('task_delete_', '');
        await this.deleteTask(taskId, chatId);
      } else if (data.startsWith('task_completed_')) {
        const taskId = data.replace('task_completed_', '');
        await this.showCompletedBy(taskId, chatId);
      }
      
      await this.bot.deleteMessage(chatId, messageId).catch(() => {});
    } catch (error) {
      console.error('Task callback error:', error);
    }
  }
}

module.exports = TaskHandler;