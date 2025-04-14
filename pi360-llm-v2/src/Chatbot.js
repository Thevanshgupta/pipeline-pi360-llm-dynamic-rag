import React, { useState, useRef, useEffect } from 'react';
import './Chatbot.css';

const Chatbot = () => {
  const [messages, setMessages] = useState(() => {
    try {
      const savedMessages = localStorage.getItem('chatbotMessages');
      return savedMessages ? JSON.parse(savedMessages) : [];
    } catch (error) {
      console.error('Error loading messages:', error);
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeSection, setActiveSection] = useState('research');
  const chatWindowRef = useRef(null);
  const userId = 'user123';

  useEffect(() => {
    try {
      localStorage.setItem('chatbotMessages', JSON.stringify(messages));
    } catch (error) {
      console.error('Error saving messages:', error);
    }
  }, [messages]);

  useEffect(() => {
    chatWindowRef.current?.scrollTo(0, chatWindowRef.current.scrollHeight);
  }, [messages]);

  const WORKER_URLS = {
    workshop: 'https://pi360-rag-sql-generator.theshinchangupta.workers.dev',
    students: 'https://pi360-sql-generator.karan-cse.workers.dev',
    training: 'https://pi360-rag-sql-generator.theshinchangupta.workers.dev',
    research: 'https://pi360-rag-sql-generator.theshinchangupta.workers.dev',
    seminar: 'https://pi360-rag-sql-generator.theshinchangupta.workers.dev',
    conference: 'https://pi360-rag-sql-generator.theshinchangupta.workers.dev',
  };

  const LLM_WORKER_URL = 'https://pi360-chatbot-rag.theshinchangupta.workers.dev'; // Updated to match your deployed URL
  const clearConversation = () => {
    setMessages([]);
    localStorage.removeItem('chatbotMessages');
  };

  const exportCSV = (data, filename = 'data.csv') => {
    if (!data || data.length === 0) return;
    const csvContent = [
      Object.keys(data[0]).join(','),
      ...data.map(item => Object.values(item).map(value => `"${value}"`.replace(/\n/g, ' ')).join(','))
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const beautifyResponse = async (responseContent, userQuery) => {
    try {
      const response = await fetch('https://pi360-deepseek-model.theshinchangupta.workers.dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: `Format the data into a concise, professional response in 3 lines max. One-word queries get one-word answers.\n\nDATA: ${JSON.stringify(responseContent)}` },
            { role: 'user', content: `Format this for: "${userQuery}"` }
          ],
        }),
      });
      if (!response.ok) throw new Error('Beautification failed');
      const data = await response.json();
      return data.response.replace(/\*\*|<\/?think>/g, '').trim();
    } catch (error) {
      console.error('Beautify Error:', error);
      return responseContent.count ? `Count: ${responseContent.count}` : 'Sorry, I couldn’t retrieve the data. Please try again or contact support.';
    }
  };

  const callLLM = async (userInput, previousMessages) => {
    try {
      console.log('Calling LLM worker:', { userId, section: activeSection, content: userInput, previousMessages });
      const response = await fetch(LLM_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          section: activeSection,
          content: userInput, // Changed from 'input' to 'content'
          previousMessages,
        }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM worker failed: ${response.status} - ${errorText}`);
      }
      const data = await response.json();
      console.log('LLM Response:', data);
      return { llmResponse: data.response, enhancedPrompt: data.enhancedPrompt || userInput }; // Fallback to original input
    } catch (error) {
      console.error('LLM Worker Error:', error);
      return { llmResponse: `Error: ${error.message}`, enhancedPrompt: null };
    }
  };

  const renderTable = (data) => {
    if (!data || data.length === 0) return <p>No data available</p>;
    const keys = Object.keys(data[0]);
    return (
      <div className="table-container">
        <button className="export-csv-button" onClick={() => exportCSV(data)}>Export CSV</button>
        <table className="data-table">
          <thead><tr>{keys.map(key => <th key={key}>{key}</th>)}</tr></thead>
          <tbody>{data.map((item, index) => <tr key={index}>{keys.map(key => <td key={key}>{item[key]}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    const tempId = Date.now();
    const userMessage = { id: tempId, type: 'user', content: input, timestamp: tempId, section: activeSection };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      let responseData = {};
      const payload = { schemaName: activeSection, content: input };
      console.log('Calling SQL worker with payload:', payload);

      const { llmResponse, enhancedPrompt } = await callLLM(input, messages);
      const sqlInput = enhancedPrompt || input;
      console.log('Using SQL input:', sqlInput);

      const sqlPayload = { schemaName: activeSection, content: sqlInput };
      const workerResponse = await fetch(WORKER_URLS[activeSection], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sqlPayload),
      });
      if (!workerResponse.ok) {
        const errorText = await workerResponse.text();
        console.warn('SQL Worker failed:', errorText);
        responseData = { llm: `Sorry, I encountered an issue processing your request: ${errorText}. Please try rephrasing or contact support.`, enhancedPrompt: sqlInput };
      } else {
        const workerData = await workerResponse.json();
        console.log('SQL Response:', workerData);
        let sqlQuery = workerData.query;

        if (!sqlQuery || !sqlQuery.trim().toUpperCase().startsWith('SELECT')) {
          console.warn('Invalid SQL query, falling back to LLM:', sqlQuery);
          responseData = { llm: `Sorry, I couldn’t generate a valid query for "${sqlInput}". Please try again or contact support.`, enhancedPrompt: sqlInput };
        } else {
          const encodedQuery = btoa(sqlQuery);
          const chatResponse = await fetch(
            `https://pi360.net/site/api/endpoints/chat.php?institute_id=mietjammu&secret=R0dqSDg3Njc2cC00NCNAaHg=&query=${encodedQuery}`
          );
          if (!chatResponse.ok) throw new Error('Chat API failed: ' + await chatResponse.text());
          const chatData = await chatResponse.json();

          if (chatData.response_code === "200") {
            const beautified = await beautifyResponse(chatData.content, sqlInput);
            responseData = { sql: sqlQuery, rawData: chatData.content, beautified, llm: llmResponse, enhancedPrompt: sqlInput };
          } else {
            throw new Error(chatData.response_message || 'Unknown error');
          }
        }
      }

      setMessages(prev => prev.map(msg => 
        msg.id === tempId ? { ...msg, response: responseData } : msg
      ));
    } catch (error) {
      console.error('Error in handleSend:', error);
      const { llmResponse } = await callLLM(input, messages);
      setMessages(prev => prev.map(msg => 
        msg.id === tempId ? { ...msg, response: { llm: `Error: ${error.message}. ${llmResponse}`, enhancedPrompt: input } } : msg
      ));
    } finally {
      setIsLoading(false);
    }
  };

  const renderResponse = (response, error) => {
    if (!response) return null;
    return (
      <div className="bot-response">
        {response.error && <div className="error-message">Error: {response.error}</div>}
        {response.enhancedPrompt && <div className="enhanced-prompt">Enhanced Prompt: {response.enhancedPrompt}</div>}
        {response.llm && <div className="llm-response">{response.llm}</div>}
        {response.sql && <div className="sql-query">SQL: {response.sql}</div>}
        {response.beautified && <div className="beautified-response">{response.beautified}</div>}
        {response.rawData && renderTable(response.rawData)}
      </div>
    );
  };

  return (
    <div className="chatbot-container">
      <div className="section-selector">
        {['students', 'research', 'training', 'seminar', 'conference', 'workshop'].map(section => (
          <button key={section} className={activeSection === section ? 'active' : ''} onClick={() => setActiveSection(section)}>
            {section.charAt(0).toUpperCase() + section.slice(1)}
          </button>
        ))}
        <button className="clear-history-button" onClick={clearConversation}>Clear History</button>
      </div>
      
      <div className="chat-window" ref={chatWindowRef}>
        {messages.length === 0 ? (
          <div className="empty-chat">Start a conversation below!</div>
        ) : (
          messages.map(message => (
            <div key={message.id} className="message-container">
              <div className={`message ${message.type}`}>
                <div className="message-content">
                  {message.type === 'user' && <div className="user-icon">You</div>}
                  <div className="text-content">
                    {message.content}
                    <div className="message-meta">Section: {message.section} | {new Date(message.timestamp).toLocaleTimeString()}</div>
                  </div>
                </div>
              </div>
              {renderResponse(message.response, message.error)}
            </div>
          ))
        )}
        {isLoading && <div className="typing-indicator"><div className="dot"></div><div className="dot"></div><div className="dot"></div></div>}
      </div>

      <div className="input-container">
        <div className="input-wrapper">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Type your message..."
            onKeyPress={e => e.key === 'Enter' && handleSend()}
          />
          <button onClick={handleSend} disabled={isLoading} className="send-button">
            <svg className="send-icon" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>
          </button>
        </div>
        <div className="disclaimer">Responses may contain inaccuracies. Verify important info.</div>
      </div>
    </div>
  );
};

export default Chatbot;