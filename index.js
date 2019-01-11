/*!
 * cookie-session
 * Copyright(c) 2013 Jonathan Ong
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * Copyright(c) 2016 Oliver Salzburg
 * MIT Licensed
 */

"use strict";

/**
 * Module dependencies.
 * @private
 */
const debug     = require( "debug" )( "cookie-session" );
const Cookies   = require( "cookies" );
const onHeaders = require( "on-headers" );

/**
 * Module exports.
 * @public
 */

module.exports = cookieSession;

/**
 * Create a new cookie session middleware.
 *
 * @param {object} [options]
 * @param {boolean} [options.httpOnly=true]
 * @param {array} [options.keys]
 * @param {string} [options.name=session] Name of the cookie to use
 * @param {boolean} [options.overwrite=true]
 * @param {string} [options.secret]
 * @param {boolean} [options.signed=true]
 * @return {function} middleware
 * @public
 */

function cookieSession( options ) {
	const opts = options || {};

	// Cookie name
	const name = opts.name || "session";

	// Secrets
	let keys = opts.keys;
	if( !keys && opts.secret ) {
		keys = [ opts.secret ];
	}

	// Defaults
	if( null == opts.overwrite ) {
		opts.overwrite = true;
	}
	if( null == opts.httpOnly ) {
		opts.httpOnly = true;
	}
	if( null == opts.signed ) {
		opts.signed = true;
	}

	if( !keys && opts.signed ) {
		throw new Error( ".keys required." );
	}

	debug( "session options %j", opts );

	return function _cookieSession( req, res, next ) {
		const cookies = req.sessionCookies = new Cookies( req, res, {
			keys : keys
		} );
		let sess;

		// To pass to Session()
		req.sessionOptions = Object.create( opts );
		req.sessionKey     = name;

		req.__defineGetter__( "session", function getSession() {
			// Already retrieved
			if( sess ) {
				return sess;
			}

			// Unset
			if( sess === false ) {
				return null;
			}

			// Get or create session
			return ( sess = tryGetSession( req ) || createSession( req ) );
		} );

		req.__defineSetter__( "session", function setSession( val ) {
			if( val == null ) {
				// Unset session
				sess = false;
				return val;
			}

			if( typeof val === "object" ) {
				// Create a new session
				sess = Session.create( this, val );
				return sess;
			}

			throw new Error( "req.session can only be set as null or an object." );
		} );

		onHeaders( res, function setHeaders() {
			if( sess === undefined ) {
				// Not accessed
				return;
			}

			try {
				if( sess === false ) {
					// Remove
					cookies.set( name, "", req.sessionOptions );
				} else if( ( !sess.isNew || sess.isPopulated ) && sess.isChanged ) {
					// Save populated or non-new changed session
					sess.save();
				}
			} catch( e ) {
				debug( "error saving session %s", e.message );
			}
		} );

		next();
	};
}

/**
 * Session model.
 *
 * @param {Context} ctx
 * @param {Object} obj
 * @private
 */

class Session {
	constructor( ctx, obj ) {
		Object.defineProperty( this, "_ctx", {
			value : ctx
		} );

		if( obj ) {
			for( let key in obj ) {
				this[ key ] = obj[ key ];
			}
		}
	}

	/**
	 * Create new session.
	 * @private
	 */
	static create( req, obj ) {
		const ctx = new SessionContext( req );
		return new Session( ctx, obj );
	}

	/**
	 * Create session from serialized form.
	 * @private
	 */
	static deserialize( req, str ) {
		const ctx = new SessionContext( req );
		const obj = decode( str );

		ctx._new = false;
		ctx._val = str;

		return new Session( ctx, obj );
	}

	/**
	 * Serialize a session to a string.
	 * @private
	 */
	static serialize( sess ) {
		return encode( sess );
	}

	/**
	 * Return if the session is changed for this request.
	 *
	 * @return {Boolean}
	 * @public
	 */
	get isChanged() {
		return this._ctx._new || this._ctx._val !== Session.serialize( this );
	}

	/**
	 * Return if the session is new for this request.
	 *
	 * @return {Boolean}
	 * @public
	 */
	get isNew() {
		return this._ctx._new;
	}

	/**
	 * Return how many values there are in the session object.
	 * Used to see if it's "populated".
	 *
	 * @return {Number}
	 * @public
	 */
	get length() {
		return Object.keys( this ).length;
	}

	/**
	 * Populated flag, which is just a boolean alias of .length.
	 *
	 * @return {Boolean}
	 * @public
	 */
	get isPopulated() {
		return Boolean( this.length );
	}

	/**
	 * Save session changes by performing a Set-Cookie.
	 * @private
	 */
	save() {
		const ctx = this._ctx;
		const val = Session.serialize( this );

		const cookies = ctx.req.sessionCookies;
		const name    = ctx.req.sessionKey;
		const opts    = ctx.req.sessionOptions;

		debug( "save %s", val );
		cookies.set( name, val, opts );
	}
}

/**
 * Session context to tie session to req.
 *
 * @param {Request} req
 * @private
 */

function SessionContext( req ) {
	this.req = req;

	this._new = true;
	this._val = undefined;
}

/**
 * Create a new session.
 * @private
 */

function createSession( req ) {
	debug( "new session" );
	return Session.create( req );
}

/**
 * Decode the base64 cookie value to an object.
 *
 * @param {String} string
 * @return {Object}
 * @private
 */

function decode( string ) {
	const body = Buffer.from( string, "base64" ).toString( "utf8" );
	return JSON.parse( body );
}

/**
 * Encode an object into a base64-encoded JSON string.
 *
 * @param {Object} body
 * @return {String}
 * @private
 */

function encode( body ) {
	const str = JSON.stringify( body );
	return Buffer.from( str ).toString( "base64" );
}

/**
 * Try getting a session from a request.
 * @private
 */

function tryGetSession( req ) {
	const cookies = req.sessionCookies;
	const name    = req.sessionKey;
	const opts    = req.sessionOptions;

	const str = cookies.get( name, opts );

	if( !str ) {
		return undefined;
	}

	debug( "parse %s", str );

	try {
		return Session.deserialize( req, str );
	} catch( err ) {
		if( !( err instanceof SyntaxError ) ) {
			throw err;
		}
		return undefined;
	}
}
