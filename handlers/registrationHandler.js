const { db } = require('../firebase');

class RegistrationHandler {
  constructor(bot, db) {
    this.bot = bot;
    this.db = db;
    this.registrationStates = new Map();
    
    // Define required groups
    this.requiredGroups = [
      {
        name: 'Daily Combo Review',
        link: 'https://t.me/DailyComboReview',
        username: '@DailyComboReview' // Group username for checking
      },
      {
        name: 'TG Naija Update',
        link: 'https://t.me/TGNAIJAUPDATE',
        username: '@TGNAIJAUPDATE'
      },
      {
        name: 'Only TAPTAP',
        link: 'https://t.me/onlyTAPTAP',
        username: '@onlyTAPTAP'
      },
      {
        name: 'G Unlimited Channel',
        link: 'https://t.me/Gunlimitedchannel',
        username: '@Gunlimitedchannel'
      }
    ];
  }

  async startRegistration(userId, chatId, username, referrerId = null) {
    await this.bot.sendMessage(
      chatId,
      `WELCOME, @${username}\nEnter your X username with @ (make sure to make no mistake)`
    );

    this.registrationStates.set(userId.toString(), {
      step: 'xusername',
      username: username,
      referrerId: referrerId // Store referrer ID if any
    });
  }

  async getRegistrationState(userId) {
    return this.registrationStates.get(userId.toString());
  }

  async handleRegistrationInput(userId, chatId, text, messageId) {
    const state = this.registrationStates.get(userId.toString());

    if (!state) return;

    try {
      switch (state.step) {
        case 'xusername':
          if (!text.startsWith('@')) {
            await this.bot.sendMessage(chatId, 'Please enter a valid username starting with @');
            return;
          }

          state.xUsername = text;
          state.step = 'phone';
          await this.bot.sendMessage(chatId, 'Enter Phone number For data payouts using +234XXXXXXXXXX');
          break;

        case 'phone':
          if (!text.match(/^\+234\d{10}$/)) {
            await this.bot.sendMessage(chatId, 'Please enter a valid Nigerian phone number starting with +234');
            return;
          }

          state.phone = text;
          state.step = 'network';
          await this.bot.sendMessage(chatId, 'Enter Network (MTN, GLO, AIRTEL, 9MOBILE)');
          break;

        case 'network':
          const network = text.toUpperCase();
          if (!['MTN', 'GLO', 'AIRTEL', '9MOBILE'].includes(network)) {
            await this.bot.sendMessage(chatId, 'Please enter a valid network (MTN, GLO, AIRTEL, 9MOBILE)');
            return;
          }

          state.network = network;
          state.step = 'complete';

          // Send completion message with loading animation
          const loadingMsg = await this.bot.sendMessage(chatId, '⏳ Processing registration...');

          // Wait 5 seconds
          await new Promise(resolve => setTimeout(resolve, 5000));

          // Save to Firebase
          await this.db.collection('users').doc(userId.toString()).set({
            userId: userId.toString(),
            username: state.username,
            xUsername: state.xUsername,
            phone: state.phone,
            network: state.network,
            balance: 0,
            registered: true,
            banned: false,
            referredBy: state.referrerId,
            registrationDate: new Date().toISOString(),
            completedTasks: [],
            totalReferrals: 0,
            joinedGroups: false // Track if user has joined groups
          });

          // Process referral bonus if there's a referrer
          if (state.referrerId) {
            await this.processReferralBonus(state.referrerId, userId.toString(), chatId);
          }

          await this.bot.deleteMessage(chatId, loadingMsg.message_id);

          // Ask user to join groups before accessing dashboard
          await this.askToJoinGroups(userId, chatId);

          this.registrationStates.delete(userId.toString());
          break;
      }
    } catch (error) {
      console.error('Registration error:', error);
      await this.bot.sendMessage(chatId, 'An error occurred. Please try /start again.');
      this.registrationStates.delete(userId.toString());
    }
  }

  async askToJoinGroups(userId, chatId) {
    const groupsList = this.requiredGroups.map(g => `• ${g.name}`).join('\n');
    
    const message = `
⚠️ *IMPORTANT: Join Our Groups*

To access your dashboard and start earning, you MUST join all our required groups:

${groupsList}

Not joining might result in future ban.

*Click the buttons below to join:*
    `;

    // Create inline keyboard with group links
    const keyboard = [];
    
    // Add group buttons
    this.requiredGroups.forEach(group => {
      keyboard.push([{ text: `Join ${group.name}`, url: group.link }]);
    });
    
    // Add verification button
    keyboard.push([{ text: '✅ I Have Joined All Groups', callback_data: 'verify_groups' }]);

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  }

  async verifyGroupMembership(userId, chatId) {
    try {
      const loadingMsg = await this.bot.sendMessage(chatId, '🔍 Verifying group membership...');

      let allJoined = true;
      const notJoinedGroups = [];

      // Check each group
      for (const group of this.requiredGroups) {
        try {
          // Get clean username without @
          const chatUsername = group.username.replace('@', '');
          
          // Try to get chat member status
          const chat = await this.bot.getChat(`@${chatUsername}`);
          const member = await this.bot.getChatMember(chat.id, userId);
          
          // Check if user is member, administrator, or creator
          const isMember = ['member', 'administrator', 'creator'].includes(member.status);
          
          if (!isMember) {
            allJoined = false;
            notJoinedGroups.push(group.name);
          }
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          console.log(`Error checking group ${group.name}:`, error.message);
          
          // If we can't verify, assume not joined
          allJoined = false;
          notJoinedGroups.push(`${group.name} (unable to verify)`);
        }
      }

      await this.bot.deleteMessage(chatId, loadingMsg.message_id);

      if (allJoined) {
        // Update user's joinedGroups status
        await this.db.collection('users').doc(userId.toString()).update({
          joinedGroups: true,
          groupsJoinedAt: new Date().toISOString()
        });

        // Send success message and show dashboard
        await this.bot.sendMessage(
          chatId,
          '✅ *Verification Successful!*\n\nThank you for joining all groups. You now have full access to your dashboard.',
          { parse_mode: 'Markdown' }
        );

        // Trigger dashboard refresh
        const userHandler = require('./userHandler');
        const handler = new userHandler(this.bot, this.db);
        await handler.showDashboard(userId, chatId);
      } else {
        // Show which groups they haven't joined
        const missingGroups = notJoinedGroups.map(g => `• ${g}`).join('\n');
        
        await this.bot.sendMessage(
          chatId,
          `❌ *Verification Failed*\n\nYou haven't joined the following groups:\n\n${missingGroups}\n\nPlease join all groups and click verify again.`,
          { 
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔄 Verify Again', callback_data: 'verify_groups' }]
              ]
            }
          }
        );
      }
    } catch (error) {
      console.error('Group verification error:', error);
      await this.bot.sendMessage(
        chatId,
        '❌ Error verifying groups. Please try again or contact support.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Try Again', callback_data: 'verify_groups' }]
            ]
          }
        }
      );
    }
  }

  async processReferralBonus(referrerId, newUserId, newUserChatId) {
    try {
      // Check if pool has enough balance
      const poolDoc = await this.db.collection('settings').doc('pool').get();
      const pool = poolDoc.exists ? poolDoc.data().amount : 0;
      const bonusAmount = 50; // 50MB each

      if (pool < (bonusAmount * 2)) {
        console.log('Not enough pool balance for referral bonus');
        return;
      }

      // Get referrer info
      const referrerDoc = await this.db.collection('users').doc(referrerId).get();
      if (!referrerDoc.exists) return;

      const referrer = referrerDoc.data();

      // Get new user info
      const newUserDoc = await this.db.collection('users').doc(newUserId).get();
      const newUser = newUserDoc.data();

      // Start batch operation
      const batch = this.db.batch();

      // Update referrer balance and referral count
      const referrerRef = this.db.collection('users').doc(referrerId);
      batch.update(referrerRef, {
        balance: (referrer.balance || 0) + bonusAmount,
        totalReferrals: (referrer.totalReferrals || 0) + 1
      });

      // Update new user balance
      const newUserRef = this.db.collection('users').doc(newUserId);
      batch.update(newUserRef, {
        balance: (newUser.balance || 0) + bonusAmount
      });

      // Update pool
      const poolRef = this.db.collection('settings').doc('pool');
      batch.update(poolRef, {
        amount: pool - (bonusAmount * 2)
      });

      await batch.commit();

      // Send notification to referrer
      try {
        await this.bot.sendMessage(
          referrerId,
          `🎉 *Referral Bonus Earned!*\n\n` +
          `@${newUser.username} just completed registration using your referral link!\n\n` +
          `You both received ${bonusAmount}MB bonus! 💰\n\n` +
          `Total Referrals: ${(referrer.totalReferrals || 0) + 1}`,
          { parse_mode: 'Markdown' }
        );
      } catch (notifyError) {
        console.log('Could not notify referrer:', notifyError.message);
      }

      // Send notification to new user
      try {
        await this.bot.sendMessage(
          newUserId,
          `🎉 *Welcome Bonus!*\n\n` +
          `You received ${bonusAmount}MB for joining through a referral link!\n\n` +
          `Your referrer @${referrer.username} also got ${bonusAmount}MB! 🎊\n\n` +
          `Don't forget to join our required groups to access your dashboard!`,
          { parse_mode: 'Markdown' }
        );
      } catch (notifyError) {
        console.log('Could not notify new user:', notifyError.message);
      }

      // Notify admins
      const admins = process.env.ADMIN_IDS.split(',');
      for (const adminId of admins) {
        try {
          await this.bot.sendMessage(
            adminId,
            `🔄 *Referral Bonus Processed*\n\n` +
            `Referrer: @${referrer.username}\n` +
            `New User: @${newUser.username}\n` +
            `Bonus: ${bonusAmount}MB each\n` +
            `Total: ${bonusAmount * 2}MB from pool`,
            { parse_mode: 'Markdown' }
          );
        } catch (adminError) {
          console.log('Could not notify admin:', adminError.message);
        }
      }

    } catch (error) {
      console.error('Referral bonus error:', error);
    }
  }
}

module.exports = RegistrationHandler;