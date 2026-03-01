class AdminHandler {
  constructor(bot, db) {
    this.bot = bot;
    this.db = db;
  }

  async showAdminDashboard(chatId) {
    try {
      // Get counts
      const usersSnapshot = await this.db.collection('users').get();
      const usersCount = usersSnapshot.size;

      // Get total balance
      let totalBalance = 0;
      usersSnapshot.forEach(doc => {
        totalBalance += doc.data().balance || 0;
      });

      // Get today's pool
      const poolDoc = await this.db.collection('settings').doc('pool').get();
      const todayPool = poolDoc.exists ? poolDoc.data().amount || 0 : 0;

      // Get eligible users for today
      const settingsDoc = await this.db.collection('settings').doc('config').get();
      const minPayout = settingsDoc.exists ? settingsDoc.data().minPayout || 0 : 0;

      let eligibleUsers = 0;
      usersSnapshot.forEach(doc => {
        if ((doc.data().balance || 0) >= minPayout) {
          eligibleUsers++;
        }
      });

      // Get tasks count
      const tasksSnapshot = await this.db.collection('tasks').get();
      const tasksCount = tasksSnapshot.size;

      // Get admins count
      const adminsCount = process.env.ADMIN_IDS.split(',').length;

      // Determine if payout can be started (not when both are zero)
      const canStartPayout = !(todayPool === 0 && totalBalance === 0);

      const adminText = `
👋 *Welcome, Admin*

👥 Users count: ${usersCount}
💰 Total Balance: ${totalBalance.toFixed(2)} MB
📦 Today's pool: ${todayPool.toFixed(2)} MB
🎯 Eligible users: ${eligibleUsers}
📊 Status: Active
📋 Earn Tasks: ${tasksCount}
👤 Admins: ${adminsCount}
⚡ Darlington says 👋

*Available Commands:*
/ban [id] - Ban user
/stop - Stop bot for users
/on - Start bot for users
/set_pool [amount] - Set pool (only when pool = 0)
/search [query] - Search users
/set_min [amount] - Set minimum payout
/task - Manage tasks
      `;

      const inlineKeyboard = [
        [
          { text: '👥 Users', callback_data: 'users_list' },
          { text: '💰 Start Payout', callback_data: 'start_payout' }
        ],
        [
          { text: '📋 Tasks', callback_data: 'admin_task' },
          { text: '🔄 Refresh', callback_data: 'admin_dashboard' }
        ]
      ];

      // Disable payout button if both pool and balance are zero
      if (!canStartPayout) {
        inlineKeyboard[0][1] = { text: '💰 Start Payout (Disabled)', callback_data: 'payout_disabled' };
      }

      await this.bot.sendMessage(chatId, adminText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      });
    } catch (error) {
      console.error('Admin dashboard error:', error);
      await this.bot.sendMessage(chatId, 'Error loading admin dashboard.');
    }
  }

  async banUser(targetId, chatId) {
    try {
      await this.db.collection('users').doc(targetId.toString()).update({
        banned: true
      });
      await this.bot.sendMessage(chatId, `✅ User ${targetId} has been banned.`);
    } catch (error) {
      console.error('Ban error:', error);
      await this.bot.sendMessage(chatId, 'Error banning user.');
    }
  }

  async setPool(amount, chatId) {
    try {
      const poolDoc = await this.db.collection('settings').doc('pool').get();
      const currentPool = poolDoc.exists ? poolDoc.data().amount : 0;

      if (currentPool !== 0) {
        await this.bot.sendMessage(chatId, '❌ Pool can only be set when it is 0');
        return;
      }

      await this.db.collection('settings').doc('pool').set({
        amount: amount,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      await this.bot.sendMessage(chatId, `✅ Pool set to ${amount} MB`);
    } catch (error) {
      console.error('Set pool error:', error);
      await this.bot.sendMessage(chatId, 'Error setting pool.');
    }
  }

  async setMinPayout(amount, chatId) {
    try {
      await this.db.collection('settings').doc('config').set({
        minPayout: amount,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      await this.bot.sendMessage(chatId, `✅ Minimum payout set to ${amount} MB`);
    } catch (error) {
      console.error('Set min payout error:', error);
      await this.bot.sendMessage(chatId, 'Error setting minimum payout.');
    }
  }

  async searchUsers(query, chatId) {
    try {
      const usersSnapshot = await this.db.collection('users').get();
      const results = [];

      usersSnapshot.forEach(doc => {
        const user = doc.data();
        if (user.username?.toLowerCase().includes(query.toLowerCase()) || 
            user.xUsername?.toLowerCase().includes(query.toLowerCase()) || 
            user.phone?.includes(query)) {
          results.push(user);
        }
      });

      if (results.length === 0) {
        await this.bot.sendMessage(chatId, 'No users found.');
        return;
      }

      let resultText = '🔍 *Search Results*\n\n';
      results.forEach((user, index) => {
        resultText += `${index + 1}. (${user.xUsername || 'No X'}) (@${user.username || 'No TG'}) (${user.balance || 0} MB) /ban_${user.userId}\n`;
      });

      await this.bot.sendMessage(chatId, resultText, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Search error:', error);
      await this.bot.sendMessage(chatId, 'Error searching users.');
    }
  }

  async showUsersList(chatId) {
    try {
      const usersSnapshot = await this.db.collection('users').get();

      if (usersSnapshot.empty) {
        await this.bot.sendMessage(chatId, 'No users found.');
        return;
      }

      // Convert to array
      const users = [];
      usersSnapshot.forEach(doc => {
        users.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // Send users in chunks to avoid message too long error
      let userListText = '👥 *Users List*\n\n';
      let count = 0;
      
      for (const user of users) {
        count++;
        const balance = user.balance || 0;
        const xUsername = user.xUsername || 'No X';
        const tgUsername = user.username || 'No TG';
        const userId = user.userId || user.id;
        
        userListText += `${count}. (${xUsername}) (@${tgUsername}) (${balance} MB) /ban_${userId}\n`;

        // Send in chunks of 20 users
        if (count % 20 === 0) {
          await this.bot.sendMessage(chatId, userListText, { parse_mode: 'Markdown' });
          userListText = '';
        }
      }

      // Send remaining users
      if (userListText) {
        await this.bot.sendMessage(chatId, userListText, { parse_mode: 'Markdown' });
      }

      // Add summary
      const totalBalance = users.reduce((sum, user) => sum + (user.balance || 0), 0);
      const summaryText = `📊 *Summary*\nTotal Users: ${users.length}\nTotal Balance: ${totalBalance.toFixed(2)} MB`;
      await this.bot.sendMessage(chatId, summaryText, { parse_mode: 'Markdown' });

    } catch (error) {
      console.error('Users list error:', error);
      await this.bot.sendMessage(chatId, 'Error loading users list.');
    }
  }



  
  
    async startPayout(chatId) {
  try {
    // Get pool and total balance
    const poolDoc = await this.db.collection('settings').doc('pool').get();
    const pool = poolDoc.exists ? poolDoc.data().amount : 0;

    const usersSnapshot = await this.db.collection('users').get();
    let totalBalance = 0;
    usersSnapshot.forEach(doc => {
      totalBalance += doc.data().balance || 0;
    });

    // Check if payout can be started (not when both are zero)
    if (pool === 0 && totalBalance === 0) {
      await this.bot.sendMessage(chatId, '❌ Cannot start payout: Both pool and total balance are zero.');
      return;
    }

    const settingsDoc = await this.db.collection('settings').doc('config').get();
    const minPayout = settingsDoc.exists ? settingsDoc.data().minPayout || 0 : 0;

    const eligibleUsers = [];

    usersSnapshot.forEach(doc => {
      const user = doc.data();
      if ((user.balance || 0) >= minPayout && !user.banned) {
        eligibleUsers.push({
          ...user,
          id: doc.id
        });
      }
    });

    if (eligibleUsers.length === 0) {
      await this.bot.sendMessage(chatId, 'No eligible users found.');
      return;
    }

    // Sort eligible users by balance
    eligibleUsers.sort((a, b) => (b.balance || 0) - (a.balance || 0));

    let payoutText = '💰 *Eligible Users for Payout*\n\n';
    
    eligibleUsers.forEach((user, index) => {
      const xUsername = user.xUsername || 'No X';
      const phoneNumber = user.phone || 'No phone';
      const network = user.network || 'Unknown';
      const balance = user.balance || 0;
      const userId = user.userId || user.id;
      
      // Format: [xusername] - [phonenumber] - [network] - [amount]
      // Make phone number and balance copiable using backticks
      payoutText += `${index + 1}. [${xUsername}] - \`${phoneNumber}\` - [${network}] - \`${balance} MB\`\n`;
      
      // Add ban command on a new line for easy access
      payoutText += `   /ban_${userId}\n\n`;
    });

    // Calculate total eligible balance
    const totalEligibleBalance = eligibleUsers.reduce((sum, user) => sum + (user.balance || 0), 0);

    payoutText += `\n📊 *Summary*\n`;
    payoutText += `Total eligible: ${eligibleUsers.length} users\n`;
    payoutText += `Total eligible balance: \`${totalEligibleBalance.toFixed(2)} MB\`\n`;
    payoutText += `Pool amount: \`${pool} MB\`\n`;
    payoutText += `Total balance (all users): \`${totalBalance.toFixed(2)} MB\`\n\n`;
    payoutText += '_Click confirm to reset all user balances to 0 and process payout_\n';

    await this.bot.sendMessage(chatId, payoutText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Confirm Payout', callback_data: 'confirm_payout' }],
          [{ text: '❌ Cancel', callback_data: 'admin_dashboard' }]
        ]
      }
    });
  } catch (error) {
    console.error('Start payout error:', error);
    await this.bot.sendMessage(chatId, 'Error starting payout.');
  }
}



async confirmPayout(chatId) {
  try {
    // Get payout settings
    const settingsDoc = await this.db.collection('settings').doc('config').get();
    const minPayout = settingsDoc.exists ? settingsDoc.data().minPayout || 0 : 0;
    
    // Get pool amount
    const poolDoc = await this.db.collection('settings').doc('pool').get();
    const poolAmount = poolDoc.exists ? poolDoc.data().amount || 0 : 0;
    
    // Get all users
    const usersSnapshot = await this.db.collection('users').get();
    
    // Find eligible users
    const eligibleUsers = [];
    usersSnapshot.forEach(doc => {
      const user = doc.data();
      if ((user.balance || 0) >= minPayout && !user.banned) {
        eligibleUsers.push({ id: doc.id, ...user });
      }
    });
    
    if (eligibleUsers.length === 0) {
      await this.bot.sendMessage(chatId, '❌ No eligible users found for payout.');
      return;
    }
    
    // Send loading message
    const loadingMsg = await this.bot.sendMessage(
      chatId, 
      `⏳ hope you are done sending payments...`,
      { parse_mode: 'Markdown' }
    );
    
    // Statistics
    let totalPaid = 0;
    let successCount = 0;
    let failCount = 0;
    
    // Process each eligible user
    for (const user of eligibleUsers) {
      try {
        const payoutAmount = user.balance;
        
        // Create payout record
        const payoutId = Date.now() + user.id;
        await this.db.collection('payouts').doc(payoutId).set({
          userId: user.id,
          username: user.username,
          phone: user.phone,
          amount: payoutAmount,
          status: 'paid',
          paidAt: new Date().toISOString(),
          minPayout: minPayout
        });
        
        // Send sweet notification to user
        const userMessage = `
🎉 *PAYOUT RECEIVED!* 🎉
━━━━━━━━━━━━━━━━

💎 *Amount:* ${payoutAmount.toFixed(2)} MB
📱 *Phone:* ${user.phone}
⏰ *Time:* ${new Date().toLocaleString()}

━━━━━━━━━━━━━━━━
✨ *Thank you for earning with us!* ✨

💫 Your data has been credited successfully!
🔥 Keep earning more with tasks and referrals!

━━━━━━━━━━━━━━━━
🔔 *Next payout:* Soon!
        `;
        
        await this.bot.sendMessage(user.id, userMessage, {
          parse_mode: 'Markdown'
        }).catch(err => {
          console.log(`Could not notify user ${user.id}:`, err.message);
          failCount++;
        });
        
        totalPaid += payoutAmount;
        successCount++;
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (userError) {
        console.error(`Error processing user ${user.id}:`, userError);
        failCount++;
      }
    }
    
    // Reset all user balances to 0
    const batch = this.db.batch();
    usersSnapshot.forEach(doc => {
      const userRef = this.db.collection('users').doc(doc.id);
      batch.update(userRef, { balance: 0 });
    });
    await batch.commit();
    
    // Reset pool
    await this.db.collection('settings').doc('pool').set({
      amount: 0,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    
    // Delete loading message
    await this.bot.deleteMessage(chatId, loadingMsg.message_id);
    
    // Send beautiful summary to admin
    const summaryMessage = `
✅ *PAYOUT* ✅
━━━━━━━━━━━━━━━━━━━━━━

📊 *PAYOUT SUMMARY*
━━━━━━━━━━━━━━━━
👥 *Total Users:* ${usersSnapshot.size}
🎯 *Eligible Users:* ${eligibleUsers.length}
✅ *Successfully Paid:* ${successCount}
❌ *Failed Notifications:* ${failCount}

👑 *Darlington's System*
    `;
    
    await this.bot.sendMessage(chatId, summaryMessage, {
      parse_mode: 'Markdown'
    });
    
    // Show admin dashboard
    await this.showAdminDashboard(chatId);
    
  } catch (error) {
    console.error('Confirm payout error:', error);
    await this.bot.sendMessage(
      chatId, 
      '❌ *Error processing payout.*\nPlease check logs and try again.',
      { parse_mode: 'Markdown' }
    );
  }
}

  async handleCallback(data, chatId, messageId) {
    try {
      if (data === 'admin_dashboard') {
        await this.showAdminDashboard(chatId);
      } else if (data === 'users_list') {
        await this.showUsersList(chatId);
      } else if (data === 'start_payout') {
        await this.startPayout(chatId);
      } else if (data === 'confirm_payout') {
        await this.confirmPayout(chatId);
      } else if (data === 'admin_task') {
        // Send the /task command
        await this.bot.sendMessage(chatId, '/task');
      } else if (data === 'payout_disabled') {
        await this.bot.answerCallbackQuery(chatId, {
          text: 'Payout disabled: Both pool and total balance are zero',
          show_alert: true
        });
        return;
      } else if (data.startsWith('ban_')) {
        const userId = data.replace('ban_', '');
        await this.banUser(userId, chatId);
      }

      // Delete the callback message
      await this.bot.deleteMessage(chatId, messageId).catch(() => {});
    } catch (error) {
      console.error('Admin callback error:', error);
    }
  }
}

module.exports = AdminHandler;