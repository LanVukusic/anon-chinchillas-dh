import React, { useCallback, useEffect, useRef, useState } from 'react';
import io, { Socket } from 'socket.io-client';

import { SignalData } from 'simple-peer';

import {
  Badge,
  Box,
  Button,
  Card,
  Container,
  Flex,
  Group,
  LoadingOverlay,
  Paper,
  ScrollArea,
  SimpleGrid,
  Skeleton,
  Stack,
  Title,
} from '@mantine/core';
import { useStore } from '@nanostores/react';
import { IconCalendarCheck, IconNotebook } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import Peer from 'simple-peer/simplepeer.min.js';
import { $currUser } from '../global-state/user';
import { Streamer } from './audioStreamRecorder';
import { $activeMeet } from '../global-state/activeRoom';
import { useMeetingsControllerUpdate } from '../api/meetings/meetings';
import { UpdateMeetingDtoStatus } from '../api/model';

interface VideoProps {
  peer: Peer.Instance;
}

const Video: React.FC<VideoProps> = ({ peer }) => {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    peer.on('stream', (stream: MediaStream) => {
      if (ref.current) {
        ref.current.srcObject = stream;
      }
    });
  }, [peer]);

  return <video style={{ maxWidth: '400px' }} playsInline autoPlay ref={ref} />;
};

const videoConstraints = {
  height: window.innerHeight / 2,
  width: window.innerWidth / 2,
};

interface PeerData {
  peerID: string;
  peer: Peer.Instance;
}

interface Transcript {
  start: number;
  end: number;
  content: string;
  username: string;
}

const Room = () => {
  const [peers, setPeers] = useState<Peer.Instance[]>([]);
  const socketRef = useRef<Socket>();
  const userVideo = useRef<HTMLVideoElement>(null);
  const peersRef = useRef<PeerData[]>([]);
  const redirect = useNavigate();

  const viewportRef = useRef<HTMLDivElement>(null);

  // const params = useParams();

  // const roomID = (params.meetingId || '0').toString();
  const selectedMeet = useStore($activeMeet);

  const user = useStore($currUser);

  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const { mutateAsync, isPending } = useMeetingsControllerUpdate();

  console.log({ transcripts });

  const endMeeting = async () => {
    if (confirm('Sure want to end the meeting?')) {
      mutateAsync({
        id: selectedMeet?.id.toString() || '',
        data: {
          status: UpdateMeetingDtoStatus.finished,
        },
      }).finally(() => {
        socketRef.current?.close();
        window.location.replace('/');
      });
    }
  };

  const scrollToBottom = useCallback(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTo({
        top: viewportRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, []);

  useEffect(() => {
    if (!selectedMeet) {
      return;
    }
    socketRef.current = io('http://142.93.161.127:3000');
    // socketRef.current = io('http://localhost:3000');

    socketRef.current.emit('join audio', user?.sub);

    socketRef.current.on('transcript', (data: Transcript) => {
      setTranscripts((prev) => [...prev, data]);
    });

    navigator.mediaDevices
      .getUserMedia({
        video: videoConstraints,
        audio: {
          channelCount: 1,
          echoCancellation: true,
        },
      })
      .then((stream) => {
        if (userVideo.current) {
          userVideo.current.srcObject = stream;

          new Streamer(
            stream,
            new AudioContext({ sampleRate: 16000 }),
            (data) => {
              if (!socketRef.current) {
                console.error('Socket not connected');
                return;
              }
              socketRef.current.emit('audio', data);
            },
          );
        }

        if (!socketRef.current) {
          console.error('Socket not connected');
          return;
        }

        console.log('Joining room', selectedMeet.id);

        socketRef.current.emit('join room', selectedMeet.id);

        socketRef.current.on('all users', (users: string[]) => {
          const peers: Peer.Instance[] = [];
          users.forEach((userID) => {
            if (!socketRef.current) {
              console.error('No stream');
              return;
            }

            const peer = createPeer(userID, socketRef.current.id, stream);
            peersRef.current.push({
              peerID: userID,
              peer,
            });

            console.log(peersRef.current.length);
            peers.push(peer);
          });
          setPeers(peers);
        });

        socketRef.current.on(
          'user joined',
          (payload: { signal: SignalData; callerID: string }) => {
            console.log(
              `My id: ${socketRef.current?.id}, Caller id: ${payload.callerID}`,
            );

            const peer = addPeer(payload.signal, payload.callerID, stream);
            peersRef.current.push({
              peerID: payload.callerID,
              peer,
            });

            setPeers((prevPeers) => [...prevPeers, peer]);
            scrollToBottom();
          },
        );

        console.log('Listening for signals');

        socketRef.current.on(
          'receiving returned signal',
          (payload: { id: string; signal: SignalData }) => {
            const item = peersRef.current.find((p) => p.peerID === payload.id);
            if (item) {
              item.peer.signal(payload.signal);
            }
          },
        );
      });

    return () => {
      socketRef.current?.close();
    };
  }, []);

  function createPeer(
    userToSignal: string,
    callerID: string | undefined,
    stream: MediaStream,
  ) {
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream,
    });

    peer.on('signal', (signal: SignalData) => {
      // if (signal.renegotiate || signal.transceiverRequest) return;

      socketRef.current?.emit('sending signal', {
        userToSignal,
        callerID,
        signal,
      });
    });

    return peer;
  }

  function addPeer(
    incomingSignal: SignalData,
    callerID: string,
    stream: MediaStream,
  ) {
    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream,
    });

    peer.on('signal', (signal: SignalData) => {
      socketRef.current?.emit('returning signal', { signal, callerID });
    });

    peer.signal(incomingSignal);

    return peer;
  }

  if (selectedMeet == null) {
    return <LoadingOverlay visible={true}></LoadingOverlay>;
  }

  return (
    <SimpleGrid w="100%" h="100%" cols={3} p="sm" bg="gray.1">
      <Stack h="100%" w="100%" style={{ overflow: 'hidden' }}>
        <Group justify="space-between" w="100%">
          <Group>
            <IconNotebook opacity={0.5} size="1.8rem" />
            <Title> Transcriptions </Title>
          </Group>
          <Stack gap="0">
            <Title order={2}>{selectedMeet.name}</Title>
            <Title order={6} c="violet">
              {new Date(selectedMeet.startTime).toLocaleDateString()}
            </Title>
          </Stack>
        </Group>
        <Paper
          h="100%"
          withBorder
          shadow="xl"
          p="xl"
          style={{ overflow: 'hidden' }}
        >
          <ScrollArea
            h="100%"
            w="100%"
            type="always"
            scrollbars="y"
            ref={viewportRef}
          >
            {transcripts && transcripts.length == 0 && (
              <Stack>
                <Skeleton height={8} mt={6} radius="xl" />
                <Skeleton height={8} mt={6} width="70%" radius="xl" />
                <Skeleton height={8} mt={6} width="90%" radius="xl" />
                <Skeleton height={8} mt={6} radius="xl" />
                <Skeleton height={8} mt={6} width="70%" radius="xl" />
                <Skeleton height={8} mt={6} width="70%" radius="xl" />
              </Stack>
            )}
            <Stack gap="xl">
              {transcripts.map((transcript, index) => (
                <Stack key={index} gap="xs">
                  <Badge radius="sm" variant="light">
                    {transcript.username}
                  </Badge>
                  {transcript.content}
                </Stack>
              ))}
            </Stack>
          </ScrollArea>
        </Paper>
      </Stack>

      <Flex
        justify="center"
        align="center"
        wrap="wrap"
        h="100%"
        style={{
          gridColumnStart: 2,
          gridColumnEnd: 4,
        }}
      >
        <div>
          <video
            muted
            ref={userVideo}
            autoPlay
            playsInline
            style={{
              maxWidth: '400px',
              borderRadius: '5px',
              border: '1px solid --mantine-color-gray-1',
            }}
          />
          <Badge size="lg" ml="-50%" color="gray" variant="white">
            You
          </Badge>
        </div>

        {peers.map((peer, index) => (
          <div key={index}>
            <Video peer={peer} />
            <Badge size="lg" ml="-50%" color="gray" variant="white">
              {/* {JSON.stringify(peer, null, 2)} */}
            </Badge>
          </div>
        ))}
        <Group w="100%" mt="auto" mb="xl">
          <Button
            variant="subtle"
            color="red"
            onClick={() => {
              window.location.replace('/');
            }}
          >
            Leave
          </Button>
          <Button
            variant="light"
            rightSection={<IconCalendarCheck />}
            onClick={() => {
              endMeeting();
            }}
          >
            Finish meet
          </Button>
        </Group>
      </Flex>
    </SimpleGrid>
  );
};

export default Room;
