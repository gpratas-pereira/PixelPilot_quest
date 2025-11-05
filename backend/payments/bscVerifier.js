const { ethers } = require('ethers');

const TRANSFER_EVENT_TOPIC = ethers.id('Transfer(address,address,uint256)');

class BscPaymentVerifier {
    constructor(options) {
        const {
            dbAll,
            dbRun,
            providerUrl,
            usdtContract,
            walletAddress,
            minConfirmations = 12,
            pollInterval = 60000,
            tokenDecimals = 18,
            logger = console
        } = options;

        if (!dbAll || !dbRun) {
            throw new Error('BscPaymentVerifier requires dbAll and dbRun helpers');
        }

        this.dbAll = dbAll;
        this.dbRun = dbRun;
        this.logger = logger;
        this.pollInterval = Math.max(15000, pollInterval);
        this.minConfirmations = Math.max(1, minConfirmations);
        this.tokenDecimals = tokenDecimals;
        try {
            this.walletAddress = walletAddress ? ethers.getAddress(walletAddress).toLowerCase() : null;
        } catch (err) {
            this.logger.error('[BSC] Invalid wallet address provided for verifier:', walletAddress, err.message);
            this.walletAddress = null;
        }

        try {
            this.usdtContract = usdtContract ? ethers.getAddress(usdtContract).toLowerCase() : null;
        } catch (err) {
            this.logger.error('[BSC] Invalid USDT contract address provided for verifier:', usdtContract, err.message);
            this.usdtContract = null;
        }
        this.providerUrl = providerUrl;
        this.provider = null;
        this.timer = null;
        this.running = false;
        this.interface = new ethers.Interface([
            'event Transfer(address indexed from, address indexed to, uint256 value)'
        ]);
    }

    async initProvider() {
        if (this.provider || !this.providerUrl) {
            return;
        }
        this.provider = new ethers.JsonRpcProvider(this.providerUrl, undefined, {
            staticNetwork: true
        });
        await this.provider.ready;
        this.logger.log('[BSC] Connected to BNB Smart Chain RPC endpoint.');
    }

    start() {
        if (this.timer || !this.providerUrl || !this.usdtContract || !this.walletAddress) {
            return;
        }

        this.initProvider().catch((err) => {
            this.logger.error('[BSC] Failed to initialize provider:', err);
        });

        this.timer = setInterval(() => this.runCycle(), this.pollInterval);
        this.runCycle().catch((err) => {
            this.logger.error('[BSC] Initial verification cycle failed:', err);
        });

        this.logger.log('[BSC] Payment verifier started (interval:', this.pollInterval, 'ms)');
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async runCycle() {
        if (this.running) {
            this.logger.log('[BSC] Verification cycle already running; skipping this interval.');
            return;
        }
        this.running = true;

        try {
            if (!this.provider) {
                await this.initProvider();
            }
            if (!this.provider) {
                this.logger.warn('[BSC] Provider unavailable; verification skipped.');
                return;
            }

            this.logger.log('[BSC] Starting verification cycle...');
            const pendingTickets = await this.dbAll(
                `SELECT ticket_id, pilot_id, payment_reference, payment_amount, payment_currency, package_label, package_minutes
                 FROM tickets
                 WHERE payment_status = 'pending'
                   AND payment_reference IS NOT NULL
                   AND TRIM(payment_reference) != ''
                 ORDER BY purchased_at ASC
                 LIMIT 25`
            );

            if (!pendingTickets.length) {
                this.logger.log('[BSC] No pending tickets awaiting verification.');
            }

            for (const ticket of pendingTickets) {
                try {
                    this.logger.log(`[BSC] Verifying ticket ${ticket.ticket_id} (tx: ${ticket.payment_reference})`);
                    await this.processTicket(ticket);
                } catch (err) {
                    this.logger.error('[BSC] Error processing ticket', ticket.ticket_id, err);
                    await this.recordFailure(ticket.ticket_id, `Verifier error: ${err.message || err}`);
                }
            }
            this.logger.log('[BSC] Verification cycle finished.');
        } finally {
            this.running = false;
        }
    }

    async processTicket(ticket) {
        const txHash = (ticket.payment_reference || '').trim();
        if (!/^0x([0-9a-fA-F]{64})$/.test(txHash)) {
            await this.recordFailure(ticket.ticket_id, 'Invalid transaction hash format');
            this.logger.warn(`[BSC] Ticket ${ticket.ticket_id}: invalid transaction hash '${txHash}'.`);
            return;
        }

        this.logger.log(`[BSC] Fetching transaction ${txHash} for ticket ${ticket.ticket_id}`);
        const tx = await this.provider.getTransaction(txHash);
        if (!tx) {
            await this.recordPending(ticket.ticket_id, 'Transaction not found on BSC');
            this.logger.log(`[BSC] Ticket ${ticket.ticket_id}: transaction ${txHash} not yet present on-chain.`);
            return;
        }

        const receipt = await this.provider.getTransactionReceipt(txHash);
        if (!receipt) {
            await this.recordPending(ticket.ticket_id, 'Transaction pending confirmation');
            this.logger.log(`[BSC] Ticket ${ticket.ticket_id}: transaction ${txHash} waiting for receipt.`);
            return;
        }

        if (!receipt.status) {
            await this.recordFailure(ticket.ticket_id, 'Transaction failed on-chain');
            this.logger.warn(`[BSC] Ticket ${ticket.ticket_id}: transaction ${txHash} reverted on-chain.`);
            return;
        }

        const currentBlock = await this.provider.getBlockNumber();
        const confirmations = currentBlock - receipt.blockNumber + 1;
        if (confirmations < this.minConfirmations) {
            await this.recordPending(
                ticket.ticket_id,
                `Waiting confirmations (${confirmations}/${this.minConfirmations})`
            );
            this.logger.log(`[BSC] Ticket ${ticket.ticket_id}: ${confirmations}/${this.minConfirmations} confirmations so far.`);
            return;
        }

        const transfer = this.findTransferToWallet(receipt.logs);
        if (!transfer) {
            await this.recordFailure(ticket.ticket_id, 'No USDT transfer to race wallet detected');
            this.logger.warn(`[BSC] Ticket ${ticket.ticket_id}: no transfer to ${this.walletAddress} in tx ${txHash}.`);
            return;
        }

        const onChainValue = transfer.value;
        const onChainAmount = Number(ethers.formatUnits(onChainValue, this.tokenDecimals));
        const expectedAmountNumber = ticket.payment_amount ? Number(ticket.payment_amount) : null;
        let expectedAmountUnits = null;

        if (expectedAmountNumber && !Number.isNaN(expectedAmountNumber)) {
            try {
                expectedAmountUnits = ethers.parseUnits(expectedAmountNumber.toString(), this.tokenDecimals);
            } catch (err) {
                this.logger.warn('[BSC] Unable to parse expected payment amount for ticket', ticket.ticket_id, err.message);
            }
        }

        if (expectedAmountUnits && onChainValue < expectedAmountUnits) {
            await this.recordFailure(
                ticket.ticket_id,
                `On-chain amount ${onChainAmount} ${ticket.payment_currency || 'USDT'} lower than expected ${expectedAmountNumber}`
            );
            this.logger.warn(`[BSC] Ticket ${ticket.ticket_id}: received ${onChainAmount} < expected ${expectedAmountNumber}.`);
            return;
        }

        await this.markTicketPaid(ticket.ticket_id, onChainAmount, confirmations);
        this.logger.log(`[BSC] Ticket ${ticket.ticket_id}: confirmed payment of ${onChainAmount} USDT with ${confirmations} confirmations.`);
    }

    findTransferToWallet(logs) {
        if (!Array.isArray(logs)) {
            return null;
        }

        const matches = [];

        for (const log of logs) {
            if (!log || !log.address) {
                continue;
            }
            if (log.address.toLowerCase() !== this.usdtContract) {
                continue;
            }
            if (!Array.isArray(log.topics) || log.topics[0] !== TRANSFER_EVENT_TOPIC) {
                continue;
            }

            try {
                const parsed = this.interface.parseLog(log);
                const to = (parsed.args.to || parsed.args[1]).toLowerCase();
                if (to === this.walletAddress) {
                    matches.push({
                        from: (parsed.args.from || parsed.args[0]).toLowerCase(),
                        to,
                        value: parsed.args.value || parsed.args[2]
                    });
                }
            } catch (err) {
                // ignore malformed logs
            }
        }

        if (!matches.length) {
            return null;
        }

        if (matches.length === 1) {
            return matches[0];
        }

        return matches.reduce((largest, current) =>
            current.value > largest.value ? current : largest
        );
    }

    async recordPending(ticketId, message) {
        await this.dbRun(
            `UPDATE tickets
             SET verification_attempts = COALESCE(verification_attempts, 0) + 1,
                 last_verification_at = CURRENT_TIMESTAMP,
                 verification_error = ?
             WHERE ticket_id = ?`,
            [message, ticketId]
        );
        this.logger.log(`[BSC] Ticket ${ticketId} pending verification: ${message}`);
    }

    async recordFailure(ticketId, message) {
        // Determine if this is a permanent failure or a temporary one
        const permanentFailures = [
            'Invalid transaction hash format',
            'Transaction failed on-chain',
            'No USDT transfer to race wallet detected'
        ];
        
        const isPermanentFailure = permanentFailures.some(failure => 
            message.includes(failure)
        );
        
        // Also check if this ticket has had too many verification attempts (>10)
        const ticketInfo = await this.dbGet(`
            SELECT verification_attempts 
            FROM tickets 
            WHERE ticket_id = ?
        `, [ticketId]);
        
        const attemptCount = (ticketInfo?.verification_attempts || 0) + 1;
        const shouldMarkFailed = isPermanentFailure || attemptCount > 10;
        
        await this.dbRun(
            `UPDATE tickets
             SET verification_attempts = ?,
                 last_verification_at = CURRENT_TIMESTAMP,
                 verification_error = ?,
                 payment_status = CASE 
                     WHEN ? THEN 'failed'
                     ELSE payment_status
                 END
             WHERE ticket_id = ?`,
            [attemptCount, message.slice(0, 255), shouldMarkFailed, ticketId]
        );
        
        if (shouldMarkFailed) {
            this.logger.warn(`[BSC] Ticket ${ticketId} marked as failed: ${message} (attempts: ${attemptCount})`);
        }
    }

    async dbGet(query, params = []) {
        return new Promise((resolve, reject) => {
            this.dbAll(query, params).then(rows => {
                resolve(rows && rows.length > 0 ? rows[0] : null);
            }).catch(reject);
        });
    }

    async markTicketPaid(ticketId, onChainAmount, confirmations) {
        await this.dbRun(
            `UPDATE tickets
             SET payment_status = 'paid',
                 payment_currency = COALESCE(payment_currency, 'USDT'),
                 payment_amount = CASE
                     WHEN payment_amount IS NULL OR payment_amount <= 0 THEN ?
                     ELSE payment_amount
                 END,
                 verification_attempts = COALESCE(verification_attempts, 0) + 1,
                 last_verification_at = CURRENT_TIMESTAMP,
                 verification_error = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE ticket_id = ?`,
            [onChainAmount, ticketId]
        );
        this.logger.log(`[BSC] Ticket ${ticketId} verified on-chain. Amount: ${onChainAmount}, confirmations: ${confirmations}`);
    }
}

module.exports = { BscPaymentVerifier };
