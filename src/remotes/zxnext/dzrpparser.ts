import * as assert from 'assert';
const{Transform}=require('stream')



/**
 * The DZP commands and responses.
 * The response contains the command with the bit 7 set.
 */
export enum DZRP {
	CMD_GET_CONFIG=1,
	CMD_GET_REGISTERS=2,
	CMD_SET_REGISTER=3,
	CMD_WRITE_BANK=4,
	CMD_CONTINUE=5,
	CMD_PAUSE=6,

	CMD_ADD_BREAKPOINT=7,
	CMD_REMOVE_BREAKPOINT=8,

	CMD_ADD_WATCHPOINT=9,
	CMD_REMOVE_WATCHPOINT=0xA,

	CMD_READ_MEM=0xB,
	CMD_WRITE_MEM=0xC,


	CMD_GET_SLOTS=0xD,
};

/**
 * DZRP notifications.
 */
export enum DZRP_NTF {
	NTF_PAUSE = 1
};



/**
 * This parser reads the first 4 bytes and interpretes it as (little endian) length.
 * Then it collects 'length' further bytes.
 * When all bytes have been received the data is emitted.
 */
export class DzrpParser extends Transform {
	/// State: Either waiting for length (false) or collecting data (true).
	protected collectingData: boolean;

	/// The number of remaining bytes to collect.
	protected remainingLength: number;

	/// Timeout. Max time between chunks.
	protected timeout=20000; //1000;	// ms

	/// The timer.
	protected timer;

	// Sequence Number 0-255. Used for sending.
	protected sequenceNumber: number;

	// Name, for debugging purposes.
	protected name: string|undefined;


	/// The constructor.
	/// @param name Add a name for debugging purposes.
	constructor(options={}, name?: string) {
		super(options);
		assert(options);

		// Timeout
		if ((options as any).timeout!=undefined)
			this.timeout=(options as any).timeout;

		// Alloc buffer
		this.buffer=Buffer.alloc(0);
		this.collectingData=false;
		this.remainingLength=0;
		this.timer=undefined;
		this.sequenceNumber=0;
		this.name=name;
	}


	/**
	 * Returns the next sequence number for sending
	 */
	public getNextSeqNo(): number {
		this.sequenceNumber++;
		if (this.sequenceNumber>255)
			this.sequenceNumber=1;
		return this.sequenceNumber;
	}


	/**
	 * Creates an error text.
	 * I.e. Adds name and some constant text to it.
	 */
	public ErrorWithText(text: string): Error {
		let wholeText="DZRP";
		if (this.name)
			wholeText+=" ("+this.name+")";
		wholeText+=": "+text;
		const err=new Error(wholeText);
		return err;
	}


	/**
	 * Should be started a soon as a response is expected.
	 * @param errorText The text that is emitted if the timer expires.
	 */
	public startTimer(errorText: string) {
		clearTimeout(this.timer);	// Stop previous timer.
		this.timer=setTimeout(() => {
			this.emit('error', this.ErrorWithText('Timeout: ' + errorText));
		}, this.timeout);
	}


	/**
	 *  Read chunks of data until a complete message has been received.
	 */
	_transform(chunk, encoding, cb) {
		// Stop timer
		console.log(this.name, "0 clear timer, remainingLength=", this.remainingLength, "chunk=", chunk.length, ", buffer=", this.buffer.length, chunk);
		clearTimeout(this.timer);
		this.timer=undefined;
		// Concat data
		this.buffer=Buffer.concat([this.buffer, chunk])
		while (true) {
			// Check state
			if (!this.collectingData) {
				// Check if all 4 bytes have been received
				if (this.buffer.length<4)
					break;
				const data=this.buffer;
				this.remainingLength=data[0]+(data[1]<<8)+(data[2]<<16)+(data[3]<<24);
				console.log(this.name, "0b new message, (remaining)Length=", this.remainingLength);
				if (this.remainingLength>100||this.remainingLength<0) {
					console.log("err");
				}
				this.buffer=this.buffer.subarray(4);
				this.collectingData=true;
			}

			// Collect until all remaining bytes received
			const count=this.buffer.length;
			if (count<this.remainingLength)
				break;

			// Enough data
			this.collectingData=false;

			// Check if there was too many data received
			let data=this.buffer;
			if (count>this.remainingLength) {
				data=data.subarray(0, this.remainingLength);
			}
			// Enough data collected
			console.log(this.name, "1 push, remainingLength=", this.remainingLength, ", buffer=", this.buffer.length);
			this.push(data);
			console.log(this.name, "2a remainingLength=", this.remainingLength, ", buffer=", this.buffer.length);
			this.buffer=this.buffer.subarray(this.remainingLength);	// Normally clears the buffer
			this.remainingLength=this.buffer.length;
			console.log(this.name, "2b remainingLength=", this.remainingLength, ", buffer=", this.buffer.length);
		}
		// Start timeout
		if (this.remainingLength>0) {
			this.startTimer('Too much time between two data chunks.');
			console.log(this.name, "3a set timer");
		}
		// Call callback
		console.log(this.name, "3b return, remainingLength=", this.remainingLength, ", buffer=", this.buffer.length);
		cb();
	}


	_flush(cb) {
		this.push(this.buffer)
		this.buffer=Buffer.alloc(0)
		cb()
	}
}

