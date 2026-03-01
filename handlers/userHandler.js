class UserHandler {
  constructor(bot, db) {
    this.bot = bot;
    this.db = db;
    this.userTaskIndex = new Map();
  }
async showDashboard(userId, chatId) {
  try {
    const userDoc = await this.db.collection('users').doc(userId.toString()).get();
    const user = userDoc.data();
    
    // Get today's pool
    const poolDoc = await this.db.collection('settings').doc('pool').get();
    const todayPool = poolDoc.exists ? poolDoc.data().amount || 0 : 0;
    
    // Get min payout
    const settingsDoc = await this.db.collection('settings').doc('config').get();
    const minPayout = settingsDoc.exists ? settingsDoc.data().minPayout || 0 : 0;

    // Escape special characters for markdown
    const username = user.username.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
    const xUsername = user.xUsername.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
    const phone = user.phone.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
    const network = user.network.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');

const dashboardText = `
📊 *YOUR DASHBOARD*
━━━━━━━━━━━━━━━━

👤 *Username:* @${username}
📦 *Today's Pool:* ${todayPool.toFixed(2)} MB
💰 *Min Payout:* ${minPayout.toFixed(5)} MB
📱 *X Username:* ${xUsername}
📞 *Phone:* ${phone} × ${network}

━━━━━━━━━━━━━━━━
💎 *Balance:* ${user.balance || 0} MB
━━━━━━━━━━━━━━━━

🔗 *Referral Link:*
https://t.me/yourbot?start=${userId}
`;

    // Send main menu with image
    await this.bot.sendPhoto(chatId, 'menu.jpg', {
      caption: dashboardText,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💰 Earn', callback_data: 'earn' },
            { text: '🔄 Refresh', callback_data: 'refresh' },
            { text: '🆘 Support', callback_data: 'support' }
          ]
        ]
      }
    }).catch(async () => {
      // Fallback to text if image fails
      await this.bot.sendMessage(chatId, dashboardText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💰 Earn', callback_data: 'earn' },
              { text: '🔄 Refresh', callback_data: 'refresh' },
              { text: '🆘 Support', callback_data: 'support' }
            ]
          ]
        }
      });
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    
    // Fallback without markdown
    try {
      const userDoc = await this.db.collection('users').doc(userId.toString()).get();
      const user = userDoc.data();
      
      const fallbackText = `
📊 Your Dashboard

👤 Username: @${user.username}
📦 Today's pool: ${todayPool.toFixed(2)}MB
💰 Min payout: ${minPayout.toFixed(5)}MB
📱 X.username: ${user.xUsername}
📞 PhoneNumber: ${user.phone} × ${user.network}
🔗 Referral link: https://t.me/yourbot?start=${userId}

💎 Your Balance: ${user.balance || 0}MB
      `;
      
      await this.bot.sendMessage(chatId, fallbackText, {
        parse_mode: '', // Disable markdown
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💰 Earn', callback_data: 'earn' },
              { text: '🔄 Refresh', callback_data: 'refresh' },
              { text: '🆘 Support', callback_data: 'support' }
            ]
          ]
        }
      });
    } catch (fallbackError) {
      await this.bot.sendMessage(chatId, 'Error loading dashboard. Please try again.');
    }
  }
}
  async showEarnMenu(userId, chatId) {
    try {
      // Get available tasks
      const tasksSnapshot = await this.db.collection('tasks')
        .where('active', '==', true)
        .where('deleted', '==', false)
        .get();
      
      if (tasksSnapshot.empty) {
        await this.bot.sendMessage(chatId, 'No tasks available at the moment.');
        return;
      }

      // Store tasks
      const tasks = [];
      tasksSnapshot.forEach(doc => {
        tasks.push({ id: doc.id, ...doc.data() });
      });

      // Store current task index for user
      this.userTaskIndex.set(`${userId}:${chatId}`, 0);
      
      // Show first task
      await this.displayUserTask(userId, chatId, tasks[0], 0, tasks.length);
      
    } catch (error) {
      console.error('Earn menu error:', error);
      await this.bot.sendMessage(chatId, 'Error loading tasks. Please try again.');
    }
  }

  async displayUserTask(userId, chatId, task, currentIndex, totalTasks) {
  try {
    // Check if user has completed this task
    const userDoc = await this.db.collection('users').doc(userId.toString()).get();
    const user = userDoc.data();
    const completedTasks = user.completedTasks || [];
    const isCompleted = completedTasks.includes(task.id);
    
    // Escape special characters in description
    const description = task.description.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
    
    // Completion status emoji
    const statusEmoji = isCompleted ? '✅' : '⏳';
    
    // Task details text
    const taskText = `
🆔 *Task ID:* ${task.id}
📝 *Description:*
${description}

🏆 *Points:* ${task.prize}MB
📊 *Status:* ${statusEmoji} ${isCompleted ? 'Completed' : 'Not Completed'}
    `;

    // Use task image if available, otherwise use default
    const imageUrl = task.imageUrl ||'menu.jpg';

    await this.bot.sendPhoto(chatId, imageUrl, {
      caption: taskText,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: isCompleted ? '✅ Done' : '⚡ Done', callback_data: `user_task_done_${task.id}` },
            { text: '⏩ Next', callback_data: 'user_task_next' },
            { text: '🔙 Main Menu', callback_data: 'back' }
          ]
        ]
      }
    }).catch(async () => {
      // Fallback without markdown
      const fallbackText = `
🆔 Task ID: ${task.id}
📝 Description:
${task.description}

🏆 Points: ${task.prize}MB
📊 Status: ${statusEmoji} ${isCompleted ? 'Completed' : 'Not Completed'}
      `;
      
      await this.bot.sendMessage(chatId, fallbackText, {
        parse_mode: '',
        reply_markup: {
          inline_keyboard: [
            [
              { text: isCompleted ? '✅ Done' : '⚡ Done', callback_data: `user_task_done_${task.id}` },
              { text: '⏩ Next', callback_data: 'user_task_next' },
              { text: '🔙 Main Menu', callback_data: 'back' }
            ]
          ]
        }
      });
    });
  } catch (error) {
    console.error('Display user task error:', error);
    await this.bot.sendMessage(chatId, 'Error displaying task.');
  }
}

  async navigateUserTask(userId, chatId, direction) {
    try {
      // Get all active tasks
      const tasksSnapshot = await this.db.collection('tasks')
        .where('active', '==', true)
        .where('deleted', '==', false)
        .get();
      
      const tasks = [];
      tasksSnapshot.forEach(doc => {
        tasks.push({ id: doc.id, ...doc.data() });
      });
      
      if (tasks.length === 0) {
        await this.showEarnMenu(userId, chatId);
        return;
      }
      
      const key = `${userId}:${chatId}`;
      let currentIndex = this.userTaskIndex.get(key) || 0;
      
      if (direction === 'next') {
        currentIndex = (currentIndex + 1) % tasks.length;
      }
      
      this.userTaskIndex.set(key, currentIndex);
      await this.displayUserTask(userId, chatId, tasks[currentIndex], currentIndex, tasks.length);
      
    } catch (error) {
      console.error('Navigate user task error:', error);
      await this.bot.sendMessage(chatId, 'Error navigating tasks.');
    }
  }

  async completeUserTask(userId, taskId, chatId) {
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
      const userRef = this.db.collection('users').doc(userId.toString());
      const userDoc = await userRef.get();
      const user = userDoc.data();
      const completedTasks = user.completedTasks || [];
      
      if (completedTasks.includes(taskId)) {
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
      
      // Start batch operation
      const batch = this.db.batch();
      
      // Update user balance and completed tasks
      batch.update(userRef, {
        balance: (user.balance || 0) + task.prize,
        completedTasks: [...completedTasks, taskId]
      });
      
      // Update pool
      const poolRef = this.db.collection('settings').doc('pool');
      batch.update(poolRef, {
        amount: pool - task.prize
      });
      
      // Update task
      const taskRef = this.db.collection('tasks').doc(taskId);
      const taskCompletedBy = task.completedBy || [];
      taskCompletedBy.push(userId.toString());
      const completedCount = (task.completedCount || 0) + 1;
      
      if (task.totalLimit && completedCount >= task.totalLimit) {
        batch.update(taskRef, {
          completedBy: taskCompletedBy,
          completedCount: completedCount,
          active: false,
          deleted: true
        });
      } else {
        batch.update(taskRef, {
          completedBy: taskCompletedBy,
          completedCount: completedCount
        });
      }
      
      await batch.commit();
      
      // Send success message
      await this.bot.sendMessage(chatId, `✅ Task completed! You earned ${task.prize}MB!`);
      
      // Try to refresh the task display
      const key = `${userId}:${chatId}`;
      const currentIndex = this.userTaskIndex.get(key) || 0;
      
      // Get updated tasks list
      const updatedTasksSnapshot = await this.db.collection('tasks')
        .where('active', '==', true)
        .where('deleted', '==', false)
        .get();
      
      if (!updatedTasksSnapshot.empty) {
        const updatedTasks = [];
        updatedTasksSnapshot.forEach(doc => {
          updatedTasks.push({ id: doc.id, ...doc.data() });
        });
        
        // Adjust index if needed
        const newIndex = Math.min(currentIndex, updatedTasks.length - 1);
        if (newIndex >= 0) {
          await this.displayUserTask(userId, chatId, updatedTasks[newIndex], newIndex, updatedTasks.length);
        }
      }
      
      // Try to notify admins
      try {
        const admins = process.env.ADMIN_IDS.split(',');
        for (const adminId of admins) {
          await this.bot.sendMessage(
            adminId,
            `✅ @${user.username} completed a task!\n\nTask: ${task.description}\nReward: ${task.prize}MB`
          ).catch(() => {});
        }
      } catch (adminError) {
        console.log('Admin notification error:', adminError.message);
      }
      
    } catch (error) {
      console.error('Complete task error:', error);
      
      if (error.message && error.message.includes('getaddrinfo')) {
        await this.bot.sendMessage(chatId, '⚠️ Task completed but there was a network issue. Your balance has been updated.');
      } else {
        await this.bot.sendMessage(chatId, 'Error completing task. Please try again.');
      }
    }
  }

  async handleUserCallback(userId, data, chatId, messageId) {
    try {
      if (data === 'earn') {
        await this.showEarnMenu(userId, chatId);
      } else if (data === 'refresh') {
        await this.showDashboard(userId, chatId);
      } else if (data === 'support') {
        await this.bot.sendMessage(chatId, 'Contact @support for help');
        return; // Don't delete message for support
      } else if (data === 'back') {
        await this.showDashboard(userId, chatId);
      } else if (data === 'user_task_next') {
        await this.navigateUserTask(userId, chatId, 'next');
      } else if (data.startsWith('user_task_done_')) {
        const taskId = data.replace('user_task_done_', '');
        await this.completeUserTask(userId, taskId, chatId);
      }
      
      // Delete the callback message
      await this.bot.deleteMessage(chatId, messageId).catch(() => {});
    } catch (error) {
      console.error('User callback error:', error);
    }
  }
}

module.exports = UserHandler;