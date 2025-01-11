import React, { useState, useRef, useEffect } from 'react';
import { Mic, Loader, AlertCircle, StopCircle, Volume2, VolumeX, Sparkles, MessageSquare } from 'lucide-react';

const VoiceInteraction = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [lastResponse, setLastResponse] = useState(null);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [showWelcome, setShowWelcome] = useState(true);
  
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const audioRef = useRef(null);
  const speechRecognitionRef = useRef(null);

  useEffect(() => {
    initializeAudioRecording();
    initializeSpeechRecognition();
    
    const timer = setTimeout(() => setShowWelcome(false), 3000);
    
    return () => {
      if (mediaRecorder) {
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
      }
      clearTimeout(timer);
    };
  }, []);

  const initializeSpeechRecognition = () => {
    if ('webkitSpeechRecognition' in window) {
      const recognition = new window.webkitSpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      
      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setLiveTranscript(transcript);
      };
      
      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
      };
      
      speechRecognitionRef.current = recognition;
    }
  };

  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
      setRecordingDuration(0);
    }
    return () => clearInterval(timerRef.current);
  }, [isRecording]);

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const initializeAudioRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm'
      });
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        try {
          const chunks = audioChunksRef.current;
          const audioBlob = new Blob(chunks, { type: 'audio/webm' });
          audioChunksRef.current = [];
          await handleVoiceInteraction(audioBlob);
        } catch (error) {
          console.error('Error processing audio:', error);
          setError('Error processing audio. Please try again.');
          setLoading(false);
        }
      };

      setMediaRecorder(recorder);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setError('Please enable microphone access to use voice input');
    }
  };

  const handleVoiceInteraction = async (audioBlob) => {
    try {
      setLoading(true);
      setError(null);

      // Step 1: Transcribe audio to text
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const transcribeResponse = await fetch('https://mob-mic-ui.onrender.com/api/chat/transcribe', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (!transcribeResponse.ok) {
        throw new Error(`Transcription error! status: ${transcribeResponse.status}`);
      }

      const transcriptionData = await transcribeResponse.json();
      
      if (!transcriptionData.transcript) {
        throw new Error('No transcript received');
      }

      // Step 2: Send transcribed text to chat endpoint
      const chatResponse = await fetch('https://mob-mic-ui.onrender.com/api/chat/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          userId: 'user123', // You might want to make this dynamic
          message: transcriptionData.transcript
        })
      });

      if (!chatResponse.ok) {
        throw new Error(`Chat error! status: ${chatResponse.status}`);
      }

      const chatData = await chatResponse.json();
      setLastResponse(chatData.message);

      // Step 3: Convert response to speech
      await speakResponse(chatData.message);

    } catch (error) {
      console.error('Error in voice interaction:', error);
      setError('Failed to process voice interaction. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const speakResponse = async (text) => {
    try {
      // Stop any currently playing audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      const response = await fetch('https://mob-mic-ui.onrender.com/api/chat/synthesize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          voice: 'lily',
          model: 'aurora',
          format: 'mp3',
          language: 'en',
          sample_rate: 24000,
          conversational: true
        }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`Speech synthesis error! status: ${response.status}`);
      }

      const audioBlob = await response.blob();
      if (audioBlob.size === 0) {
        throw new Error('Received empty audio response');
      }

      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      
      audio.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = (e) => {
        console.error('Audio playback error:', e);
        setIsPlaying(false);
        setError('Failed to play audio response');
        URL.revokeObjectURL(audioUrl);
      };

      setIsPlaying(true);
      await audio.play();
    } catch (error) {
      console.error('Error playing audio response:', error);
      setError('Failed to play audio response');
      setIsPlaying(false);
    }
  };

  const startRecording = () => {
    if (mediaRecorder && mediaRecorder.state === 'inactive') {
      setIsRecording(true);
      setError(null);
      setLiveTranscript('');
      audioChunksRef.current = [];
      mediaRecorder.start(250);
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.start();
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      setIsRecording(false);
      mediaRecorder.stop();
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
      }
    }
  };

  const togglePlayback = () => {
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else if (lastResponse) {
      speakResponse(lastResponse);
    }
  };

  return (
    <div className="flex flex-col items-center gap-6 p-8 bg-gradient-to-br from-purple-50 to-blue-50 rounded-2xl shadow-lg min-h-[400px] relative overflow-hidden">
      {/* Animated Background */}
      <div className="absolute inset-0 bg-grid-pattern opacity-5" />
      
      {/* Welcome Message */}
      <div className={`absolute top-0 left-0 right-0 bg-gradient-to-r from-purple-600 to-blue-600 text-white p-4 transition-transform duration-700 ease-in-out ${showWelcome ? 'translate-y-0' : '-translate-y-full'}`}>
        <div className="flex items-center justify-center gap-2">
          <Sparkles size={20} className="animate-pulse" />
          <span className="font-medium">Welcome to Voice AI Assistant</span>
        </div>
      </div>

      {/* Marketing Slogans */}
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
          Your Voice, Our Intelligence
        </h2>
        <p className="text-gray-600 mt-2">
          Speak naturally. Get intelligent responses. It's that simple.
        </p>
      </div>

      {/* Main Interaction Area */}
      <div className="relative z-10">
        {error && (
          <div className="absolute bottom-full mb-4 w-80 p-4 bg-red-50 text-red-700 rounded-xl text-sm flex items-center gap-2 shadow-lg border border-red-100 animate-fade-in">
            <AlertCircle size={16} />
            <span className="flex-1">{error}</span>
          </div>
        )}
        
        <div className="flex items-center gap-6">
          {/* Recording Duration */}
          {isRecording && (
            <div className="flex items-center gap-2 bg-red-50 px-6 py-3 rounded-full text-red-600 animate-pulse shadow-md">
              <div className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
              <span className="text-sm font-medium">{formatDuration(recordingDuration)}</span>
            </div>
          )}
          
          {/* Main Record Button */}
          <button
            onClick={() => isRecording ? stopRecording() : startRecording()}
            className={`
              relative w-20 h-20 rounded-full transition-all duration-300 transform
              flex items-center justify-center shadow-lg
              ${isRecording 
                ? 'bg-red-500 hover:bg-red-600 scale-110' 
                : 'bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600'
              } 
              ${loading ? 'bg-gray-100 cursor-not-allowed' : 'hover:scale-105'}
            `}
            disabled={loading}
          >
            {loading ? (
              <Loader className="animate-spin text-gray-500" size={32} />
            ) : isRecording ? (
              <StopCircle size={32} className="text-white" />
            ) : (
              <Mic size={32} className="text-white" />
            )}
            
            {isRecording && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-ping" />
            )}
          </button>

          {/* Playback Button */}
          {lastResponse && (
            <button
              onClick={togglePlayback}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 shadow-md
                ${isPlaying 
                  ? 'bg-gradient-to-r from-green-500 to-emerald-500' 
                  : 'bg-gradient-to-r from-purple-500 to-blue-500'
                } hover:scale-105`}
            >
              {isPlaying ? (
                <VolumeX size={24} className="text-white" />
              ) : (
                <Volume2 size={24} className="text-white" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Live Transcription Display */}
      {liveTranscript && (
        <div className="mt-6 p-6 bg-white/90 rounded-xl shadow-md w-full max-w-lg backdrop-blur-sm border border-purple-100">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare size={16} className="text-purple-500" />
            <span className="text-sm font-medium text-purple-600">Live Transcription</span>
          </div>
          <p className="text-gray-700 leading-relaxed">{liveTranscript}</p>
        </div>
      )}

      {/* AI Response Display */}
      {lastResponse && (
        <div className="mt-2 p-6 bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl shadow-md w-full max-w-lg border border-purple-100">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={16} className="text-purple-500" />
            <span className="text-sm font-medium text-purple-600">AI Response</span>
          </div>
          <p className="text-gray-700 leading-relaxed">{lastResponse}</p>
        </div>
      )}

      {/* Feature Highlights */}
      <div className="grid grid-cols-3 gap-4 mt-8 w-full max-w-lg">
        <div className="text-center p-4 bg-white/80 rounded-lg shadow-sm">
          <div className="text-purple-600 font-medium">Real-time</div>
          <div className="text-sm text-gray-600">Live transcription</div>
        </div>
        <div className="text-center p-4 bg-white/80 rounded-lg shadow-sm">
          <div className="text-purple-600 font-medium">Natural</div>
          <div className="text-sm text-gray-600">Human-like responses</div>
        </div>
        <div className="text-center p-4 bg-white/80 rounded-lg shadow-sm">
          <div className="text-purple-600 font-medium">Instant</div>
          <div className="text-sm text-gray-600">Quick processing</div>
        </div>
      </div>
    </div>
  );
};

export default VoiceInteraction;