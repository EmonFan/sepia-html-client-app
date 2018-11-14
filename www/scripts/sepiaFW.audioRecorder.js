//AUDIO PLAYER
function sepiaFW_build_audio_recorder(){
	var AudioRecorder = {};
	
	//Parameters and states
	AudioRecorder.isRecording = false;
	
	//AudioContext stuff - we support only one
	var recorderAudioContext; 	//Primary AudioContext for recorder
	var recorderAudioSource;	//Primary Source of recorder
	var audioRec;				//Primary Recorder.js instance
	
	//---- broadcasting -----
	
	function broadcastRecorderRequested(){
		//console.log('broadcastRecorderRequested');
	}
	function broadcastRecorderStopRequested(){
		//console.log('broadcastRecorderStopRequested');
	}
	function broadcastRecorderClosed(){
		//console.log('broadcastRecorderClosed');
	}
	function broadcastRecorderStarted(){
		//console.log('broadcastRecorderStarted');
	}
	function broadcastRecorderStopped(){
		//console.log('broadcastRecorderStopped');
	}
	function broadcastRecorderError(e){
		//console.log('broadcastRecorderError');
	}
	
	//-----------------------
	
	var AudioContext = window.AudioContext || window.webkitAudioContext;
	var isMediaDevicesSupported = undefined;
	var isCordovaAudioinputSupported = undefined;

	function testStreamRecorderSupport(){
		isMediaDevicesSupported = !!AudioContext
			&& ((navigator.mediaDevices && navigator.mediaDevices.getUserMedia) 
				|| navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia);
		isCordovaAudioinputSupported = (window.cordova && window.audioinput);
		return !!isMediaDevicesSupported || isCordovaAudioinputSupported;
	}
	
	AudioRecorder.isStreamRecorderSupported = testStreamRecorderSupport(); 		//set once on start
	
	//set default parameters for audio recorder
	AudioRecorder.setup = function (successCallback, errorCallback){
		//... ?
	}
	
	//STOP recorder
	AudioRecorder.stop = function (closeAfterStop, successCallback, errorCallback){
		if (!AudioRecorder.isRecording){
			//clean up?
			//...
			return;
		}
		broadcastRecorderStopRequested();

		//stop audio source and suspend context
		setTimeout(function(){
			//Audioinput plugin
			if (isCordovaAudioinputSupported){
				if (window.audioinput && window.audioinput.isCapturing()){
					window.audioinput.stop();
				}
			
			//MediaDevices interface
			}else if (isMediaDevicesSupported){
				if (recorderAudioSource && (recorderAudioSource.getAudioTracks || recorderAudioSource.stop)){
					if (recorderAudioSource.getAudioTracks){
						recorderAudioSource.getAudioTracks()[0].stop();
					}else{
						recorderAudioSource.stop();
					}
				}
			}
			//We release the audioContext here to be sure
			setTimeout(function(){
				recorderAudioContext.suspend().then(function() {	//Note: a promise that can fail ...
					//console.log('SUSPENDED audio-context');
					if (closeAfterStop){
						recorderAudioContext.close().then(function() {
							//console.log('CLOSED audio-context');
							broadcastRecorderClosed();
						});
					}
				}).catch(function(e){
					broadcastRecorderError(e);
				});
			},100);
		}, 100);
		
		//Recorder.js
		if (audioRec && audioRec.stop){
			audioRec.stop();
		}

		AudioRecorder.isRecording = false;			//TODO: this probably has to wait for callbacks to be safe
		broadcastRecorderStopped();
	}
	
	//START recorder
	AudioRecorder.start = function (successCallback, errorCallback){
		if (AudioRecorder.isRecording){
			//clean up?
			//...
			return;
		}
		broadcastRecorderRequested();
		AudioRecorder.isRecording = true;			//TODO: this probably should be updated in callbacks

		//assign active audioContext
		var activeAudioContext = recorderAudioContext; 		//this should always be the recent one set in getRecorder

		//check audio context state
		if (activeAudioContext && (activeAudioContext.state == 'suspended' || activeAudioContext.state == 'interrupted')) {
			//console.log('AudioContext suspended or interrupted -> resume');				//DEBUG
			activeAudioContext.resume().then(function() {
				broadcastRecorderStarted();
				//we deliver the context and the recorder
				successCallback(activeAudioContext, audioRec);

			}).catch(function(event){
				errorCallback(event);
				broadcastRecorderError(event);
				AudioRecorder.isRecording = false;
			});
		}else{
			//console.log('AudioContext not suspended -> go');								//DEBUG
			broadcastRecorderStarted();
			//we deliver the context and the recorder
			successCallback(activeAudioContext, audioRec);
		}
	}

	// ---------------- Audio Recorder (Recorder.js) ----------------------

	function createOrUpdateAudioContext(){
		if (recorderAudioContext){
			//TODO: clean up old context and sources?
			if (recorderAudioContext.state == "closed"){
				recorderAudioContext = new AudioContext();
			}
		}else{
			recorderAudioContext = new AudioContext();
		}
		return recorderAudioContext;
	}

	AudioRecorder.getRecorder = function(callback, errorCallback){
		//Create a new audio recorder. 
		//NOTE: audioRec is a global variable (inside this scope) because we can't have 2 anyway (I guess..)

		if (!AudioRecorder.isStreamRecorderSupported){
			errorCallback({name: "AudioRecorder: Stream recorder not supported", message: "Cannot create an audio stream recorder!"});
			return;
		}
		
		//Audioinput plugin
		if (isCordovaAudioinputSupported){
			setTimeout(function(){
				audioinputGetStreamRecorder(function(audioRec){
					callback(audioRec);
				}, errorCallback);
			}, 100);
		
		//Official MediaDevices interface
		}else if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
			navigator.mediaDevices.getUserMedia({ video : false, audio: true }).then(function(stream) {
				getStreamRecorder(stream, function(audioRec){
					callback(audioRec);
				});
			}).catch(function(err) {
				errorCallback(err);
			});
		
		//Older version of getUserMedia
		}else{
			var getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
			getUserMedia({
				"audio": true,
				"video": false,
			}, function(stream){
				getStreamRecorder(stream, function(audioRec){
					callback(audioRec);
				});
			}, function(e){
				errorCallback(err);
			});
		}
	}
	
	// ---------------- MediaDevices interface stuff ----------------------
	
	function getStreamRecorder(stream, callback){
		recorderAudioContext = createOrUpdateAudioContext();
		recorderAudioSource = stream;
		var inputPoint = recorderAudioContext.createGain();
		recorderAudioContext.createMediaStreamSource(recorderAudioSource).connect(inputPoint);
		audioRec = new RecorderJS(inputPoint);
		if (callback) callback(audioRec);
	}

	// ---------------- Audioinput plugin stuff ----------------------

	var audioInputPluginIsSet = false;
	var audioInputPluginHasPermission = false;
	var audioInputPluginErrorCallback = undefined; 		//reset on every call - TODO: lost when 2 errors are queued ...
	//Init
	function initAudioinputPlugin(){
		if (isCordovaAudioinputSupported){
			window.addEventListener('audioinputerror', onAudioInputError, false);
			audioInputPluginIsSet = true;
		}
	}
	//Errors
	function onAudioInputError(error){
		SepiaFW.debug.err("AudioRecorder error (audioinput plugin): " + JSON.stringify(error));
		if (audioInputPluginErrorCallback) audioInputPluginErrorCallback(error);
	}
	//Check permission
	function checkAudioinputPermission(successCallback, errorCallback){
		//First check whether we already have permission to access the microphone.
		window.audioinput.checkMicrophonePermission(function(hasPermission) {
			if (hasPermission){
				audioInputPluginHasPermission = true;
				if (successCallback) successCallback();
			}else{
				// Ask the user for permission to access the microphone
				window.audioinput.getMicrophonePermission(function(hasPermission, message){
					if (hasPermission) {
						SepiaFW.debug.log("AudioRecorder (audioinput plugin): User granted access to microphone :-)");
						audioInputPluginHasPermission = true;
						if (successCallback) successCallback();
					}else{
						SepiaFW.debug.err("AudioRecorder error (audioinput plugin): User refused access to microphone :-(");
						audioInputPluginHasPermission = false;
						if (errorCallback) errorCallback({name: "AudioRecorder: permission denied", message: "User refused access to microphone :-("});
					}
				});
			}
		});
	}
	//Get a recorder
	var audioinputGetStreamRecorder = function(successCallback, errorCallback){
		if (errorCallback) audioInputPluginErrorCallback = errorCallback;
		else errorCallback = undefined;

		if (!audioInputPluginIsSet){
			initAudioinputPlugin();
			if (!audioInputPluginHasPermission){
				checkAudioinputPermission(function(){
					audioinputGetStreamRecorder(successCallback, errorCallback);
				}, onAudioInputError);
				return;
			}
		}
		if (!audioInputPluginHasPermission){
			var errMsg = {name: "AudioRecorder: permission denied", message: "Not allowed to access microphone :-("};
			onAudioInputError(errMsg);
			return;
		}
		try {
			if (!window.audioinput.isCapturing()){
				//Reset context?
				recorderAudioContext = createOrUpdateAudioContext();
				//Start with default values and let the plugin handle conversion from raw data to web audio
				if (recorderAudioContext){
					window.audioinput.start({ 
						streamToWebAudio: true,
						audioContext: recorderAudioContext
					});
				}else{
					window.audioinput.start({ 
						streamToWebAudio: true
					});
					recorderAudioContext = window.audioinput.getAudioContext();
				}
				//Get input for the recorder
				var inputPoint = window.audioinput.getAudioContext().createGain();
				window.audioinput.connect(inputPoint);
				audioRec = new RecorderJS(inputPoint);
				//Done! User audioRecorder to continue
				if (successCallback) successCallback(audioRec);
			}else{
				SepiaFW.debug.err("AudioRecorder error (audioinput plugin): Tried to capture audio but was already running!");
				onAudioInputError({name: "ASR: not started!", message: "Audio capture was already running."});
			}
		}catch(error){
			SepiaFW.debug.err("AudioRecorder error (audioinput plugin) unknown exception. The following error might be displayed twice.");
			onAudioInputError(error);
		}
	};
	
	// --------------------------------------

	return AudioRecorder;
}